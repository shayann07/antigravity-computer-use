// Real cursor trajectories: minimum-jerk timing, exact endpoint and a native
// control-fence check before EVERY position update, including the final one.
using System;
using System.Drawing;
using System.Diagnostics;
using System.Threading;

namespace Axon {
    internal sealed class CursorPath {
        internal static Point Normalize(Point point,Rectangle desktop) {
            if(desktop.Width<=0||desktop.Height<=0||!desktop.Contains(point))throw new ArgumentOutOfRangeException("point");
            // Pixel centers avoid normalized-coordinate boundary rounding.
            return new Point((int)Math.Min(65535,((double)point.X-desktop.Left+.5)*65536/desktop.Width),
                             (int)Math.Min(65535,((double)point.Y-desktop.Top+.5)*65536/desktop.Height));
        }
        readonly Point start,end;
        internal int DurationMs {get;private set;}
        internal CursorPath(Point from,Point to,float scale,bool animate) {
            start=from;end=to;
            double dx=(double)to.X-from.X,dy=(double)to.Y-from.Y;
            double distance=Math.Sqrt(dx*dx+dy*dy)/Math.Max(.5,scale);
            DurationMs=!animate||distance<3?0:(int)Math.Max(120,Math.Min(600,100+10*Math.Sqrt(distance)));
        }
        // A stroke that follows another one keeps only a short approach.
        internal void Cap(int maximumMs) {if(maximumMs>=0&&DurationMs>maximumMs)DurationMs=maximumMs;}
        internal Point At(double t) {
            if(t<=0)return start;if(t>=1)return end;
            double eased=t*t*t*(10+t*(-15+6*t));
            return new Point((int)Math.Round(start.X+((double)end.X-start.X)*eased),(int)Math.Round(start.Y+((double)end.Y-start.Y)*eased));
        }
        internal int Run(Action<Point> move,Action guard,Func<double> elapsed,Action<int> sleep) {
            int frames=0;
            while(DurationMs>0 && elapsed()<DurationMs) {
                guard();move(At(elapsed()/DurationMs));frames++;sleep(16);
            }
            guard();move(end);return frames+1;
        }
        internal int Run(Action<Point> move,Action guard) {
            Stopwatch timer=Stopwatch.StartNew();return Run(move,guard,delegate {return timer.Elapsed.TotalMilliseconds;},Thread.Sleep);
        }
    }
}
