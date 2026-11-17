// Kernel-verified caller identity for the AI-app gate (#60).
//
// The service cannot learn who is calling it: Node cannot ask the kernel for
// the client process of its own pipe. This gate can. The service asks for a
// gate, hands the pipe name to its authenticated client, and the client
// connects. The gate reads the client's process id from the kernel, opens it at
// once, and walks the parent chain. Every hop must open, report a full image
// path, and be strictly older than its child; the first hop that fails ends the
// walk, so a reused process id never joins the chain. The client gets a
// one-time nonce that expires in 30 seconds, and the service redeems it here.
// The service never accepts a host name or process id from the request itself.
using System;
using System.Collections.Generic;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;

namespace Axon
{
    internal static class CallerGate
    {
        const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
        const int MaxDepth = 16;
        const int ConnectTimeoutMs = 5000;
        const int NonceLifetimeMs = 30000;

        [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetNamedPipeClientProcessId(IntPtr pipe, out uint pid);
        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageNameW(IntPtr h, uint flags, StringBuilder name, ref uint size);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessTimes(IntPtr h, out long creation, out long exit, out long kernel, out long user);
        [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int infoClass, ref BasicInfo info, int size, out int returned);

        [StructLayout(LayoutKind.Sequential)]
        struct BasicInfo
        {
            public IntPtr ExitStatus;
            public IntPtr PebBaseAddress;
            public IntPtr AffinityMask;
            public IntPtr BasePriority;
            public IntPtr UniqueProcessId;
            public IntPtr InheritedFromUniqueProcessId;
        }

        sealed class Pending
        {
            public List<Dictionary<string, object>> Chain;
            public DateTime Expires;
        }

        static readonly object Sync = new object();
        static readonly Dictionary<string, Pending> Nonces = new Dictionary<string, Pending>();

        // Opens a single-instance pipe that only the current user can reach and
        // network clients are denied. It accepts one connection and closes.
        public static object Open()
        {
            string name = "AGCU.Gate." + RandomHex(16);
            var security = new PipeSecurity();
            SecurityIdentifier user = WindowsIdentity.GetCurrent().User;
            security.AddAccessRule(new PipeAccessRule(user, PipeAccessRights.ReadWrite, AccessControlType.Allow));
            security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.NetworkSid, null), PipeAccessRights.FullControl, AccessControlType.Deny));
            // maxNumberOfServerInstances 1 creates the pipe with
            // FILE_FLAG_FIRST_PIPE_INSTANCE: if anything already owns this name,
            // creation fails instead of joining it.
            var server = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 512, 512, security);
            var thread = new Thread(delegate () { Serve(server); });
            thread.IsBackground = true;
            thread.Start();
            return new Dictionary<string, object> { { "pipe", @"\\.\pipe\" + name }, { "timeout_ms", ConnectTimeoutMs } };
        }

        static void Serve(NamedPipeServerStream server)
        {
            using (server)
            {
                try
                {
                    IAsyncResult wait = server.BeginWaitForConnection(null, null);
                    if (!wait.AsyncWaitHandle.WaitOne(ConnectTimeoutMs)) return;
                    server.EndWaitForConnection(wait);
                    uint pid;
                    if (!GetNamedPipeClientProcessId(server.SafePipeHandle.DangerousGetHandle(), out pid) || pid == 0) return;
                    List<Dictionary<string, object>> chain = Walk(pid);
                    string nonce = RandomHex(32);
                    lock (Sync)
                    {
                        Prune();
                        Nonces[nonce] = new Pending { Chain = chain, Expires = DateTime.UtcNow.AddMilliseconds(NonceLifetimeMs) };
                    }
                    byte[] reply = Encoding.ASCII.GetBytes(nonce + "\n");
                    server.Write(reply, 0, reply.Length);
                    server.Flush();
                    server.WaitForPipeDrain();
                }
                catch { }
            }
        }

        // One-time: a nonce is removed on its first redemption, valid or not.
        public static object Redeem(Dictionary<string, object> a)
        {
            string nonce = a != null && a.ContainsKey("nonce") ? Convert.ToString(a["nonce"]) : "";
            Pending found = null;
            lock (Sync)
            {
                Prune();
                if (!String.IsNullOrEmpty(nonce) && Nonces.TryGetValue(nonce, out found)) Nonces.Remove(nonce);
            }
            if (found == null) return new Dictionary<string, object> { { "resolved", false }, { "chain", new object[0] } };
            return new Dictionary<string, object> { { "resolved", found.Chain.Count > 0 }, { "chain", found.Chain.ToArray() } };
        }

        static void Prune()
        {
            var expired = new List<string>();
            foreach (var pair in Nonces) if (pair.Value.Expires <= DateTime.UtcNow) expired.Add(pair.Key);
            foreach (string key in expired) Nonces.Remove(key);
        }

        // The client hop is opened first; each parent must open, name its image
        // and be strictly older than its child, or the walk stops there.
        internal static List<Dictionary<string, object>> Walk(uint clientPid)
        {
            var chain = new List<Dictionary<string, object>>();
            IntPtr current = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, clientPid);
            if (current == IntPtr.Zero) return chain;
            uint currentPid = clientPid;
            try
            {
                long created; string image;
                if (!Describe(current, out created, out image)) return chain;
                chain.Add(Hop(currentPid, image, created));
                while (chain.Count < MaxDepth)
                {
                    var info = new BasicInfo(); int returned;
                    if (NtQueryInformationProcess(current, 0, ref info, Marshal.SizeOf(typeof(BasicInfo)), out returned) != 0) break;
                    uint parentPid = (uint)info.InheritedFromUniqueProcessId.ToInt64();
                    if (parentPid == 0 || parentPid == currentPid) break;
                    IntPtr parent = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, parentPid);
                    if (parent == IntPtr.Zero) break;
                    long parentCreated; string parentImage;
                    if (!Describe(parent, out parentCreated, out parentImage) || parentCreated >= created)
                    {
                        CloseHandle(parent);
                        break;
                    }
                    chain.Add(Hop(parentPid, parentImage, parentCreated));
                    CloseHandle(current);
                    current = parent; currentPid = parentPid; created = parentCreated;
                }
            }
            finally { CloseHandle(current); }
            return chain;
        }

        static bool Describe(IntPtr process, out long created, out string image)
        {
            created = 0; image = null;
            long exit, kernel, user;
            if (!GetProcessTimes(process, out created, out exit, out kernel, out user) || created == 0) return false;
            var name = new StringBuilder(1024); uint size = (uint)name.Capacity;
            if (!QueryFullProcessImageNameW(process, 0, name, ref size) || size == 0) return false;
            image = name.ToString(0, (int)size);
            return true;
        }

        static Dictionary<string, object> Hop(uint pid, string image, long created)
        {
            return new Dictionary<string, object> { { "pid", (long)pid }, { "path", image }, { "created", created.ToString() } };
        }

        static string RandomHex(int bytes)
        {
            var data = new byte[bytes];
            using (var rng = new RNGCryptoServiceProvider()) rng.GetBytes(data);
            var text = new StringBuilder(bytes * 2);
            foreach (byte b in data) text.Append(b.ToString("x2"));
            return text.ToString();
        }
    }
}
