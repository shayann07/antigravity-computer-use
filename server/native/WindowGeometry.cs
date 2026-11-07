// Physical-pixel window placement; no global display settings or desktop switch.
using System;
using System.Drawing;
namespace Axon {
    internal static class WindowGeometry {
        internal static Rectangle Fit(Rectangle window,Rectangle work) {
            if(window.Width<=0||window.Height<=0||work.Width<=0||work.Height<=0)throw new ArgumentOutOfRangeException("bounds");
            int width=Math.Min(window.Width,work.Width),height=Math.Min(window.Height,work.Height);
            long right=(long)work.X+work.Width-width,bottom=(long)work.Y+work.Height-height;
            long x=Math.Max(work.X,Math.Min((long)window.X,right)),y=Math.Max(work.Y,Math.Min((long)window.Y,bottom));
            return new Rectangle(checked((int)x),checked((int)y),width,height);
        }
        internal static bool Reachable(Point point,Rectangle[] displays) {
            foreach(Rectangle display in displays)if(display.Contains(point))return true;
            return false;
        }
        // Move only our own HUD. Never hide or click through a foreign cover.
        internal static bool AvoidHud(Rectangle hud,Rectangle target,Rectangle work,int margin,out Rectangle result) {
            result=hud;
            if(hud.Width<=0||hud.Height<=0||target.Width<=0||target.Height<=0||work.Width<hud.Width||work.Height<hud.Height)return false;
            Rectangle padded=target;padded.Inflate(margin,margin);
            if(!hud.IntersectsWith(padded))return true;
            int left=work.Left+margin,right=work.Right-hud.Width-margin;
            int top=work.Top+margin,bottom=work.Bottom-hud.Height-margin;
            int center=work.Left+(work.Width-hud.Width)/2;
            long best=Int64.MaxValue;
            foreach(int y in new int[]{top,bottom})foreach(int x in new int[]{left,center,right}) {
                Rectangle candidate=new Rectangle(x,y,hud.Width,hud.Height);
                if(!work.Contains(candidate)||candidate.IntersectsWith(padded))continue;
                long dx=(long)x-hud.X,dy=(long)y-hud.Y,score=dx*dx+dy*dy;
                if(score<best){best=score;result=candidate;}
            }
            return best!=Int64.MaxValue;
        }
    }
}
