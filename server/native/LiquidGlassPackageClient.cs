using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading;

namespace Axon {
    // This helper only renders a caller-owned surface. It never receives screen
    // pixels or desktop-control authority, and a failure cannot block Stop.
    internal static class LiquidGlassPackageClient {
        static readonly object Gate = new object();
        static Process process;
        static Bitmap latest;
        static string latestKey, pending, inFlight;
        static DateTime retryAfter = DateTime.MinValue;
        static bool closed;
        internal static event Action SurfaceReady;

        static LiquidGlassPackageClient() {
            AppDomain.CurrentDomain.ProcessExit += delegate { Close(); };
        }

        internal static Bitmap Surface(string state, int width, int height) {
            if(width < 16 || height < 16 || width > 4096 || height > 4096) return null;
            if(state != "active" && state != "paused" && state != "stopped" && state != "idle") state = "idle";
            string request = width + "|" + height + "|" + state;
            lock(Gate) {
                if(closed) return null;
                if(latest != null && latestKey == request) return new Bitmap(latest);
                try {
                    if(!Ensure()) return null;
                    // Coalesce identical repaint requests and keep only the most
                    // recent state while a render is already in flight.
                    pending = inFlight == request ? null : request;
                    Monitor.PulseAll(Gate);
                } catch { retryAfter = DateTime.UtcNow.AddSeconds(5); }
                return null;
            }
        }

        // The bundled host is <release>/bin/AxonHost.exe; the package helper is
        // a sibling directory at <release>/liquidglass, not inside bin.
        static bool Ensure() {
            if(process != null && Alive(process)) return true;
            if(DateTime.UtcNow < retryAfter) return false;
            if(process != null) { try { process.Dispose(); } catch { } process = null; inFlight = null; }
            string helper = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "liquidglass", "LiquidGlass.Host.exe"));
            if(!File.Exists(helper)) { retryAfter = DateTime.UtcNow.AddSeconds(5); return false; }
            var child = new Process { StartInfo = new ProcessStartInfo {
                FileName = helper, Arguments = "--stdio", UseShellExecute = false,
                RedirectStandardInput = true, RedirectStandardOutput = true,
                CreateNoWindow = true, WorkingDirectory = Path.GetDirectoryName(helper)
            } };
            if(!child.Start()) { child.Dispose(); retryAfter = DateTime.UtcNow.AddSeconds(5); return false; }
            process = child;
            var reader = new Thread(delegate() { Read(child); }) { IsBackground = true, Name = "LiquidGlassPackageReader" };
            reader.Start();
            return true;
        }

        static bool Alive(Process child) { try { return !child.HasExited; } catch { return false; } }

        static void Read(Process child) {
            try {
                while(true) {
                    string request;
                    lock(Gate) {
                        while(process == child && pending == null && Alive(child)) Monitor.Wait(Gate, 1000);
                        if(process != child || !Alive(child)) break;
                        request = pending; pending = null; inFlight = request;
                    }
                    child.StandardInput.WriteLine(request);
                    child.StandardInput.Flush();
                    var response = child.StandardOutput.ReadLineAsync();
                    if(!response.Wait(3000)) throw new TimeoutException("LiquidGlass renderer timed out");
                    string line = response.Result;
                    if(String.IsNullOrEmpty(line) || line.StartsWith("error|", StringComparison.Ordinal)) throw new IOException("LiquidGlass renderer failed");
                    Bitmap rendered;
                    using(var stream = new MemoryStream(Convert.FromBase64String(line)))
                    using(var decoded = new Bitmap(stream)) rendered = new Bitmap(decoded);
                    Action notify;
                    lock(Gate) {
                        if(process != child) { rendered.Dispose(); return; }
                        if(latest != null) latest.Dispose();
                        latest = rendered; latestKey = request; inFlight = null;
                        notify = SurfaceReady;
                    }
                    if(notify != null) try { notify(); } catch { }
                }
            } catch { }
            finally { Retire(child); }
        }

        static void Retire(Process child) {
            lock(Gate) {
                if(process != child) return;
                process = null; pending = null; inFlight = null;
                retryAfter = DateTime.UtcNow.AddSeconds(5);
                Monitor.PulseAll(Gate);
            }
            try { if(Alive(child)) child.Kill(); } catch { }
            try { child.Dispose(); } catch { }
        }

        internal static void Close() {
            Process child;
            lock(Gate) {
                closed = true; child = process; process = null; pending = null; inFlight = null;
                if(latest != null) { latest.Dispose(); latest = null; latestKey = null; }
                Monitor.PulseAll(Gate);
            }
            if(child != null) {
                try { if(Alive(child)) child.Kill(); } catch { }
                try { child.Dispose(); } catch { }
            }
        }
    }
}
