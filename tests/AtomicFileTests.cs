// Exercises AtomicFile against the real Windows ReplaceFile behaviour (#132).
using System;
using System.IO;
using System.Threading;
using Axon;

class AtomicFileTests {
    static void Write(string file, string text) { File.WriteAllText(file, text); }
    static int Main(string[] args) {
        string dir = args[0], target = Path.Combine(dir, "guard.state"), temp = target + ".tmp";
        try {
            Write(target, "one");
            // A reader that does not share delete makes ReplaceFile fail with 1175.
            // Publish must wait it out instead of failing.
            Write(temp, "two");
            var held = new FileStream(target, FileMode.Open, FileAccess.Read, FileShare.Read);
            var release = new Thread(delegate () { Thread.Sleep(300); held.Dispose(); });
            release.Start();
            AtomicFile.Publish(temp, target);
            release.Join();
            if (AtomicFile.ReadAllText(target) != "two") throw new Exception("brief lock: replacement not published");

            // Our own readers share delete, so they never block a publish.
            Write(temp, "three");
            using (var reader = new FileStream(target, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete)) {
                AtomicFile.Publish(temp, target);
            }
            if (AtomicFile.ReadAllText(target) != "three") throw new Exception("shared reader: replacement not published");

            // A lock that outlasts the budget fails, and the old contents stay complete.
            Write(temp, "four");
            bool failed = false;
            DateTime started = DateTime.UtcNow;
            using (var stuck = new FileStream(target, FileMode.Open, FileAccess.Read, FileShare.Read)) {
                try { AtomicFile.Publish(temp, target); } catch (IOException) { failed = true; } catch (UnauthorizedAccessException) { failed = true; }
            }
            double waited = (DateTime.UtcNow - started).TotalMilliseconds;
            if (!failed) throw new Exception("permanent lock: publish unexpectedly succeeded");
            if (waited < 1500 || waited > 6000) throw new Exception("permanent lock: retry budget was " + waited + " ms");
            if (AtomicFile.ReadAllText(target) != "three") throw new Exception("permanent lock: previous contents changed");

            // A missing target is created by a move.
            string fresh = Path.Combine(dir, "fresh.state");
            Write(fresh + ".tmp", "new");
            AtomicFile.Publish(fresh + ".tmp", fresh);
            if (AtomicFile.ReadAllLines(fresh)[0] != "new") throw new Exception("move: file not created");
            Console.WriteLine("PASS 4");
            return 0;
        } catch (Exception error) {
            Console.WriteLine("FAIL " + error.Message);
            return 1;
        }
    }
}
