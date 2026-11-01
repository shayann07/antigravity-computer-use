using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Threading;
using Axon;

internal static class LiquidGlassClientProbe {
    static int notifications;
    static Bitmap WaitFor(string state, int width, int height) {
        var timer = Stopwatch.StartNew();
        while(timer.ElapsedMilliseconds < 18000) {
            var image = LiquidGlassPackageClient.Surface(state, width, height);
            if(image != null) return image;
            Thread.Sleep(25);
        }
        throw new Exception("Package surface did not arrive for " + state);
    }
    static void RequireIcon(Bitmap image, int left, int right) {
        int bright = 0;
        for(int y = 12; y < 40; y++) for(int x = left; x < right; x++) {
            var color = image.GetPixel(x, y);
            if(color.R > 180 && color.G > 180 && color.B > 180) bright++;
        }
        if(bright < 10) throw new Exception("Expected Phosphor icon was not rendered");
    }
    static int Main(string[] args) {
        try {
            bool fake = args[0] == "fake";
            LiquidGlassPackageClient.SurfaceReady += delegate { Interlocked.Increment(ref notifications); };
            using(var active = WaitFor("active", 468, 50)) {
                if(active.Width != 468 || active.Height != 50) throw new Exception("Wrong active surface dimensions");
                if(fake && active.GetPixel(200, 25).R != 255) throw new Exception("Wrong active surface");
                if(!fake) { RequireIcon(active, 280, 310); RequireIcon(active, 330, 365); RequireIcon(active, 385, 412); active.Save(args[1], ImageFormat.Png); }
            }
            for(int i = 0; i < 20; i++) using(var cached = LiquidGlassPackageClient.Surface("active", 468, 50)) {
                if(cached == null) throw new Exception("Cached surface was lost");
            }
            using(var paused = WaitFor("paused", 468, 50)) {
                if(fake && paused.GetPixel(200, 25).B != 255) throw new Exception("Stale surface returned for paused state");
                if(!fake) RequireIcon(paused, 330, 365);
            }
            if(!fake) using(var stopped = WaitFor("stopped", 468, 50)) RequireIcon(stopped, 385, 412);
            using(var resized = WaitFor("active", 200, 40)) {
                if(resized.Width != 200 || resized.Height != 40) throw new Exception("Stale surface returned after resize");
            }
            var notificationTimer = Stopwatch.StartNew();
            while(notifications < 3 && notificationTimer.ElapsedMilliseconds < 1000) Thread.Sleep(10);
            if(notifications < 3) throw new Exception("Render completion notification missing");
            LiquidGlassPackageClient.Close();
            if(LiquidGlassPackageClient.Surface("active", 468, 50) != null) throw new Exception("Closed client restarted");
            Console.WriteLine("package_client_ok");
            return 0;
        } catch(Exception error) {
            Console.Error.WriteLine(error);
            LiquidGlassPackageClient.Close();
            return 1;
        }
    }
}
