// Original adaptation: publish and read small state files on Windows without
// failing on the brief locks that readers, antivirus and indexers take (#132).
using System;
using System.IO;
using System.Text;
using System.Threading;

namespace Axon {
    internal static class AtomicFile {
        // Long enough to outlast a reader or a scan of a freshly written file,
        // short enough that a stop or an input record is never held up for long.
        const int RetryBudgetMs = 2000;

        // Win32 codes that mean "someone holds the file for a moment":
        // sharing and lock violations, access denied while a delete is
        // pending, and the three ReplaceFile failures (1175-1177).
        static bool Transient(Exception error) {
            if (error is UnauthorizedAccessException) return true;
            IOException io = error as IOException;
            if (io == null || io is FileNotFoundException || io is DirectoryNotFoundException) return false;
            int code = io.HResult & 0xFFFF;
            return code == 5 || code == 32 || code == 33 || code == 1175 || code == 1176 || code == 1177;
        }

        // Replaces target with temp atomically, retrying briefly while another
        // process holds target. If the budget runs out the last error is thrown
        // and target keeps its previous complete contents.
        internal static void Publish(string temp, string target) {
            DateTime deadline = DateTime.UtcNow.AddMilliseconds(RetryBudgetMs);
            int delay = 10;
            while (true) {
                try {
                    if (File.Exists(target)) File.Replace(temp, target, null); else File.Move(temp, target);
                    return;
                } catch (Exception error) {
                    if (!Transient(error) || DateTime.UtcNow >= deadline || !File.Exists(temp)) throw;
                }
                Thread.Sleep(delay);
                delay = Math.Min(delay * 2, 100);
            }
        }

        // Readers share delete access, so they never block Publish.
        internal static string ReadAllText(string file) {
            using (FileStream stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (StreamReader reader = new StreamReader(stream, Encoding.UTF8, true))
                return reader.ReadToEnd();
        }

        // Same line semantics as File.ReadAllLines: an empty file has no lines
        // and a trailing newline does not add an empty one.
        internal static string[] ReadAllLines(string file) {
            var lines = new System.Collections.Generic.List<string>();
            using (FileStream stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (StreamReader reader = new StreamReader(stream, Encoding.UTF8, true)) {
                string line;
                while ((line = reader.ReadLine()) != null) lines.Add(line);
            }
            return lines.ToArray();
        }
    }
}
