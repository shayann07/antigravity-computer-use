using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Threading;

// Inert fixture: produces colored images and never observes or controls a desktop.
internal static class LiquidGlassFakeHelper {
    static int Main(string[] args) {
        if(args.Length != 1 || args[0] != "--stdio") return 1;
        File.WriteAllText("fixture.pid", Process.GetCurrentProcess().Id.ToString());
        File.AppendAllText("pids.txt", Process.GetCurrentProcess().Id + "\n");
        string line;
        while((line = Console.ReadLine()) != null) {
            File.AppendAllText("requests.txt", line + "\n");
            if(File.Exists("hang.once")) { File.Delete("hang.once"); Thread.Sleep(6000); }
            string[] parts = line.Split('|');
            int width = Int32.Parse(parts[0]), height = Int32.Parse(parts[1]);
            using(var image = new Bitmap(width, height)) {
                using(var graphics = Graphics.FromImage(image)) graphics.Clear(parts[2] == "paused" ? Color.Blue : Color.Red);
                using(var data = new MemoryStream()) {
                    image.Save(data, ImageFormat.Png);
                    Console.WriteLine(Convert.ToBase64String(data.ToArray()));
                    Console.Out.Flush();
                }
            }
        }
        return 0;
    }
}
