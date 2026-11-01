// Original Antigravity visual design. Uses the upstream layered-window renderer;
// no vendor artwork, cursor files, fonts, or private implementation is included.
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;
using System.IO;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace Axon {
    internal static class DesktopVisuals {
        [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint action,uint value,out bool result,uint flags);
        static bool motion=true;static DateTime motionChecked;
        internal static bool MotionEnabled { get { if((DateTime.UtcNow-motionChecked).TotalSeconds>2){bool enabled;motion=SystemParametersInfo(0x1042,0,out enabled,0)&&enabled;motionChecked=DateTime.UtcNow;}return motion; } }
        static readonly double origin=System.Diagnostics.Stopwatch.GetTimestamp()/(double)System.Diagnostics.Stopwatch.Frequency;
        internal static float BreathLevel {get {
            if(!MotionEnabled)return .94f;
            double period=ControlContract.UiNumber("breath_seconds",4.0,1.0,30.0);
            double center=ControlContract.UiNumber("breath_base",.82,0.0,1.0);
            double amplitude=ControlContract.UiNumber("breath_amplitude",.18,0.0,1.0);
            return (float)Math.Max(0,Math.Min(1,center+amplitude*Math.Sin((System.Diagnostics.Stopwatch.GetTimestamp()/(double)System.Diagnostics.Stopwatch.Frequency-origin)*Math.PI*2/period)));
        }}
        internal static readonly Color Violet = ControlContract.ColorValue("accent_rgb",Color.FromArgb(155, 205, 235));
        internal static readonly Color Blue = ControlContract.ColorValue("blue_rgb",Color.FromArgb(128, 171, 207));
        internal static readonly Color Mint = Color.FromArgb(186, 222, 232);
        internal static Color StateColor(string state) {
            return state=="paused" ? Color.FromArgb(248,199,119) : state=="stopped" ? Color.FromArgb(255,139,159) : Violet;
        }
        internal static void Edge(Graphics g, Rectangle screen, float scale) {
            // Union four Gaussian edge fields. This has no artificial rounded
            // rectangle, clipped corner wedge, nested stroke or hard inner rim.
            int w=screen.Width,h=screen.Height;float sigma=27*scale,depth=82*scale;
            // The field is separable. Evaluate the expensive falloff once per
            // row/column instead of twice for every edge pixel at startup.
            double[] horizontal=new double[w],vertical=new double[h],coreX=new double[w],coreY=new double[h];
            double core=5*scale;
            for(int x=0;x<w;x++){double d=Math.Min(x,w-1-x);horizontal[x]=Math.Exp(-d*d/(2*sigma*sigma));coreX[x]=Math.Exp(-d*d/(2*core*core));}
            for(int y=0;y<h;y++){double d=Math.Min(y,h-1-y);vertical[y]=Math.Exp(-d*d/(2*sigma*sigma));coreY[y]=Math.Exp(-d*d/(2*core*core));}
            using(Bitmap glow=new Bitmap(w,h,PixelFormat.Format32bppArgb)) {
                byte[] pixels=new byte[w*h*4];
                for(int y=0;y<h;y++)for(int x=0;x<w;x++) {
                    if(x>depth && x<w-depth && y>depth && y<h-depth)continue;
                    int alpha=(int)(154*(1-(1-horizontal[x])*(1-vertical[y]))+20*(1-(1-coreX[x])*(1-coreY[y])));
                    float t=(float)(x/(double)w*.55+y/(double)h*.45);
                    Color start=t<.55f?Violet:Blue,end=t<.55f?Blue:Color.FromArgb(165,192,218);
                    float f=t<.55f?t/.55f:(t-.55f)/.45f;
                    int i=(y*w+x)*4;pixels[i]=(byte)(start.B+(end.B-start.B)*f);pixels[i+1]=(byte)(start.G+(end.G-start.G)*f);pixels[i+2]=(byte)(start.R+(end.R-start.R)*f);pixels[i+3]=(byte)alpha;
                }
                BitmapData data=glow.LockBits(new Rectangle(0,0,w,h),ImageLockMode.WriteOnly,PixelFormat.Format32bppArgb);
                try {Marshal.Copy(pixels,0,data.Scan0,pixels.Length);}finally {glow.UnlockBits(data);}
                g.DrawImageUnscaled(glow,screen.X,screen.Y);
            }
        }
        internal static void Pointer(Graphics g,float phase) {
            // The hotspot is (48,48). Windows draws the temporary native arrow
            // above us. Four common roles share the dart; app-owned cursors and resize shapes remain application-controlled.
            using(GraphicsPath circle=new GraphicsPath()) {
                circle.AddEllipse(29,29,38,38);
                using(PathGradientBrush halo=new PathGradientBrush(circle)) {
                    halo.CenterColor=Color.FromArgb(52,Violet);halo.SurroundColors=new Color[]{Color.Transparent};
                    g.FillEllipse(halo,29,29,38,38);
                }
            }
        }
        internal static void Arrow(Graphics g) {
            // An original swept dart: a different silhouette from the Windows
            // arrow, with a luminous face, blue-grey facet and a precise tip.
            using(GraphicsPath dart=new GraphicsPath()) {
                dart.AddLine(4,2,28,16);dart.AddBezier(28,16,29.5f,17,29,18,27.8f,18.2f);
                dart.AddLine(27.8f,18.2f,17.3f,19.6f);dart.AddLine(17.3f,19.6f,11.8f,28.5f);
                dart.AddBezier(11.8f,28.5f,11,29.8f,9.9f,29.3f,9.6f,27.8f);dart.AddLine(9.6f,27.8f,4,2);dart.CloseFigure();
                var original=g.Save();g.TranslateTransform(.4f,1.1f);
                using(SolidBrush shadow=new SolidBrush(Color.FromArgb(125,19,30,42)))g.FillPath(shadow,dart);g.Restore(original);
                using(LinearGradientBrush face=new LinearGradientBrush(new Point(4,2),new Point(23,29),Color.FromArgb(250,251,252),Color.FromArgb(130,175,201)))g.FillPath(face,dart);
                using(SolidBrush facet=new SolidBrush(Color.FromArgb(100,60,113,148)))g.FillPolygon(facet,new PointF[]{new PointF(5,4),new PointF(17.3f,19.6f),new PointF(10.8f,27.4f)});
                using(Pen outline=new Pen(Color.FromArgb(240,27,39,53),1.25f)){outline.LineJoin=LineJoin.Round;g.DrawPath(outline,dart);}
                using(Pen crease=new Pen(Color.FromArgb(95,46,80,106),.8f))g.DrawLine(crease,5,4,17.3f,19.6f);
            }
        }
        internal static void NativeCursor(Graphics g,uint role) {
            if(role!=32513){Arrow(g);return;}
            // Keep the familiar text affordance and a centered insertion
            // hotspot. A pointer over every text field obscures where typing
            // will land; the same ice/ink palette still identifies control.
            using(GraphicsPath beam=new GraphicsPath()) {
                beam.AddLine(16,5,16,27);beam.StartFigure();
                beam.AddBezier(11,4,14,4,16,5,16,7);
                beam.AddBezier(16,7,16,5,18,4,21,4);beam.StartFigure();
                beam.AddBezier(11,28,14,28,16,27,16,25);
                beam.AddBezier(16,25,16,27,18,28,21,28);
                using(Pen outline=new Pen(Color.FromArgb(245,27,39,53),4)){outline.StartCap=outline.EndCap=LineCap.Round;g.DrawPath(outline,beam);}
                using(Pen face=new Pen(Color.FromArgb(242,215,238,250),1.8f)){face.StartCap=face.EndCap=LineCap.Round;g.DrawPath(face,beam);}
            }
        }
        internal const int HudWidth=470,HudHeight=52;
        internal static Rectangle ToggleRect {get {return new Rectangle(326,8,36,36);}}
        internal static Rectangle StopRect {get {return new Rectangle(374,8,88,36);}}
        internal static Rectangle ModeRect {get {return new Rectangle(278,8,36,36);}}
        static void Label(Graphics g,string text,float size,FontStyle style,Color color,RectangleF box) {
            using(Font font=new Font(Overlay.UiFont,size,style))
            using(SolidBrush brush=new SolidBrush(color))
            using(StringFormat format=new StringFormat()) {format.LineAlignment=StringAlignment.Center;format.Trimming=StringTrimming.EllipsisCharacter;format.FormatFlags=StringFormatFlags.NoWrap;g.DrawString(text,font,brush,box,format);}
        }
        internal static void Hud(Graphics g,string state,int hover,float phase,string activity=null) {
            g.SmoothingMode=SmoothingMode.AntiAlias;g.TextRenderingHint=System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
            RectangleF panel=new RectangleF(1,1,HudWidth-2,HudHeight-2);bool packageAvailable=false;
            // Render the material with the published LiquidGlass package. A
            // plain readable surface keeps the controls available if the helper
            // is missing or cannot respond; no desktop pixels are captured.
            using(GraphicsPath shape=Overlay.RoundRect(panel,21)) {
                using(Bitmap packageSurface=LiquidGlassPackageClient.Surface(state,(int)panel.Width,(int)panel.Height)) {
                    if(packageSurface!=null) {g.DrawImage(packageSurface,panel);packageAvailable=true;}
                    else using(SolidBrush fallback=new SolidBrush(Color.FromArgb(245,24,29,39)))g.FillPath(fallback,shape);
                }
            }
            string detail=state=="active"?(String.IsNullOrEmpty(activity)?"Antigravity is working":activity+" with Antigravity"):state=="paused"?"Paused · you have control":state=="stopped"?"Stopped · re-arm to begin":"Antigravity is ready";
            Label(g,detail,9,FontStyle.Regular,Color.FromArgb(240,243,246),new RectangleF(28,6,238,40));
            Rectangle hot=hover==1?ToggleRect:hover==2?StopRect:ModeRect;
            if(hover!=0)using(GraphicsPath r=Overlay.RoundRect(hot,16))using(LinearGradientBrush b=new LinearGradientBrush(hot,hover==2?Color.FromArgb(114,107,52,65):Color.FromArgb(86,90,113,137),hover==2?Color.FromArgb(72,59,31,42):Color.FromArgb(54,45,61,78),90f))g.FillPath(b,r);
            // The package surface includes the unmodified Phosphor fill icons.
            // Keep controls legible while the helper is unavailable or starting.
            if(!packageAvailable) {
                Color ink=Color.FromArgb(232,239,245);
                Label(g,"≡",13,FontStyle.Regular,ink,new RectangleF(287,6,24,40));
                Label(g,state=="active"?"Ⅱ":"▶",11,FontStyle.Regular,ink,new RectangleF(338,6,24,40));
                Label(g,state=="stopped"?"×":"■",10,FontStyle.Regular,ink,new RectangleF(393,6,22,40));
            }
            Label(g,state=="stopped"?"Hide":"Stop",8.5f,FontStyle.Regular,Color.FromArgb(222,230,237),new RectangleF(412,7,50,38));
        }
        internal static void Export(string directory) {
            Directory.CreateDirectory(directory);
            foreach(float scale in new float[]{1,1.25f,2}) {
                int w=(int)(1200*scale),h=(int)(760*scale);
                using(Bitmap image=new Bitmap(w,h,PixelFormat.Format32bppArgb)) {
                    using(Graphics g=Graphics.FromImage(image)) {
                        g.SmoothingMode=SmoothingMode.AntiAlias;
                        g.Clear(Color.FromArgb(24,26,34));
                        // A fictional desktop, never a capture of the user's data.
                        using(SolidBrush panel=new SolidBrush(Color.FromArgb(33,36,47)))g.FillRectangle(panel,90*scale,135*scale,1020*scale,520*scale);
                        using(Font f=new Font(Overlay.UiFont,20*scale))
                        using(SolidBrush ink=new SolidBrush(Color.FromArgb(190,194,211)))g.DrawString("Desktop control · visual preview",f,ink,130*scale,180*scale);
                        Edge(g,new Rectangle(0,0,w,h),scale);
                        var state=g.Save();g.TranslateTransform((w-HudWidth*scale)/2,18*scale);g.ScaleTransform(scale,scale);Hud(g,"active",0,0);g.Restore(state);
                        state=g.Save();g.TranslateTransform(650*scale,400*scale);g.ScaleTransform(scale,scale);Pointer(g,0);
                        g.TranslateTransform(44,46);Arrow(g);
                        g.Restore(state);
                    }
                    image.Save(Path.Combine(directory,"desktop-"+scale.ToString(System.Globalization.CultureInfo.InvariantCulture)+".png"),ImageFormat.Png);
                }
            }
            foreach(string state in new string[]{"active","paused","stopped","idle"})
            using(Bitmap image=new Bitmap(HudWidth*2,HudHeight*2,PixelFormat.Format32bppArgb)) {
                using(Graphics g=Graphics.FromImage(image)){g.ScaleTransform(2,2);Hud(g,state,state=="paused"?1:0,0);}
                image.Save(Path.Combine(directory,"hud-"+state+".png"),ImageFormat.Png);
            }
            foreach(uint role in new uint[]{32512,32513,32649,32650})
            using(Bitmap image=new Bitmap(96,96,PixelFormat.Format32bppArgb)) {
                using(Graphics g=Graphics.FromImage(image)){g.SmoothingMode=SmoothingMode.AntiAlias;g.ScaleTransform(3,3);NativeCursor(g,role);}
                image.Save(Path.Combine(directory,"cursor-"+role+".png"),ImageFormat.Png);
            }
            using(Bitmap image=new Bitmap(800,600,PixelFormat.Format32bppArgb)) {
                using(Graphics g=Graphics.FromImage(image)){g.SmoothingMode=SmoothingMode.AntiAlias;Edge(g,new Rectangle(0,0,800,600),1);}
                if(image.GetPixel(400,300).A!=0)throw new Exception("Edge glow obscures desktop center");
                if(image.GetPixel(400,8).A<=image.GetPixel(400,45).A)throw new Exception("Glow must fade inward");
                if(image.GetPixel(400,8).A>=210)throw new Exception("Glow became an opaque frame");
                image.Save(Path.Combine(directory,"edge-alpha.png"),ImageFormat.Png);
            }
            Console.WriteLine("Visual renders and alpha falloff checks passed.");
        }
    }
}
