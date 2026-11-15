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
        // One table of motion tokens. Components use these names; a raw
        // duration elsewhere is a mistake.
        internal const int Fast=100,Normal=200,Slow=300,FastLeave=67,NormalLeave=133;
        internal static float EaseOut(float t) {t=Math.Max(0,Math.Min(1,t));return 1-(1-t)*(1-t)*(1-t);}
        internal static float EaseIn(float t) {t=Math.Max(0,Math.Min(1,t));return t*t*t;}
        internal static float EaseInOut(float t) {t=Math.Max(0,Math.Min(1,t));return t<.5f?4*t*t*t:1-(float)Math.Pow(-2*t+2,3)/2;}
        // Colour tokens. The bar is always dark: it floats over unknown content.
        internal static readonly Color InkSurface=Color.FromArgb(18,22,29),InkRaised=Color.FromArgb(28,34,44);
        internal static readonly Color PaperText=Color.FromArgb(242,245,248),Mist=Color.FromArgb(169,180,192),Rest=Color.FromArgb(213,220,228);
        internal static readonly Color Amber=Color.FromArgb(240,184,102),Rose=Color.FromArgb(255,143,160),Slate=Color.FromArgb(27,39,53);
        internal static readonly Color Violet = ControlContract.ColorValue("accent_rgb",Color.FromArgb(155, 205, 235));
        internal static readonly Color Blue = ControlContract.ColorValue("blue_rgb",Color.FromArgb(128, 171, 207));
        internal static readonly Color Mint = Color.FromArgb(186, 222, 232);
        // One hue at four lightnesses: brightness changes, colour never does.
        internal static readonly Color GlowShade=Color.FromArgb(30,92,152),GlowHaze=Color.FromArgb(72,152,218),GlowBloom=Color.FromArgb(150,206,243),GlowFlare=Color.FromArgb(196,230,250),GlowCool=Color.FromArgb(132,194,234),GlowHot=Color.FromArgb(246,252,255);
        internal static Color StateColor(string state) {
            return state=="paused"||state=="asking" ? Amber : state=="stopped" ? Rose : state=="active" ? Violet : Rest;
        }
        static Color Mix(Color a,Color b,float t) {t=Math.Max(0,Math.Min(1,t));return Color.FromArgb((int)(a.A+(b.A-a.A)*t),(int)(a.R+(b.R-a.R)*t),(int)(a.G+(b.G-a.G)*t),(int)(a.B+(b.B-a.B)*t));}
        // The agent's pointer wears the same light as the window it works in:
        // a wide haze, a tight bloom and a hot centre, sitting behind the
        // arrow Windows draws. The hotspot is (48,48) on a 96 x 96 surface.
        internal static void Pointer(Graphics g,float phase) {
            PointF centre=new PointF(54,56);
            Halo(g,centre,40,GlowShade,70);
            Halo(g,centre,38,GlowHaze,150);
            Halo(g,centre,20,GlowBloom,205);
            Halo(g,centre,9,GlowHot,150);
        }
        static void Halo(Graphics g,PointF c,float radius,Color colour,int peak) {
            using(GraphicsPath circle=new GraphicsPath()) {
                circle.AddEllipse(c.X-radius,c.Y-radius,radius*2,radius*2);
                using(PathGradientBrush halo=new PathGradientBrush(circle)) {
                    halo.CenterPoint=c;halo.CenterColor=Color.FromArgb(peak,colour);halo.SurroundColors=new Color[]{Color.FromArgb(0,colour)};
                    // A Gaussian falloff from rim (0) to centre (1), not a linear cone.
                    Blend blend=new Blend(7);
                    for(int i=0;i<7;i++){float p=i/6f,r=1-p;blend.Positions[i]=p;blend.Factors[i]=(float)Math.Exp(-(r/.52)*(r/.52));}
                    blend.Factors[0]=0;halo.Blend=blend;
                    g.FillPath(halo,circle);
                }
            }
        }
        // The click ripple: one ring leaving the pointer, in the glow's hue.
        internal static void Ripple(Graphics g,float t) {
            float radius=MotionEnabled?12+22*EaseOut(t):16;
            using(Pen bloom=new Pen(Color.FromArgb((int)(120*(1-t)),GlowBloom),5f))g.DrawEllipse(bloom,48-radius,48-radius,2*radius,2*radius);
            using(Pen core=new Pen(Color.FromArgb((int)(235*(1-t)),GlowHot),1.6f))g.DrawEllipse(core,48-radius,48-radius,2*radius,2*radius);
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
        // ---- The control bar: a 440 x 48 pill. Left to right: the host's icon,
        // two lines of text, the Esc hint, Stop (or Hide), a hairline, Settings.
        internal const int HudWidth=440,HudHeight=48;
        internal static Rectangle StopRect {get {return new Rectangle(345,2,44,44);}}
        internal static Rectangle ModeRect {get {return new Rectangle(394,2,44,44);}}
        internal sealed class HudModel {
            internal string State="idle",Line1="",Line2="";
            internal bool Hint;            // "Press Esc to stop"
            internal int Slot;             // 0 nothing, 1 Stop, 2 Hide
            internal Image Icon;           // the host's own icon, or null
            internal float StopHover,ModeHover,TextIn=1;  // 0..1
            internal int Pressed;          // 0 none, 2 stop slot, 3 settings
            internal bool HighContrast;
        }
        static string semibold;
        static Font Face(float pixels,bool strong) {
            if(strong) {
                if(semibold==null) {
                    semibold="";
                    try {foreach(FontFamily family in FontFamily.Families)if(family.Name=="Segoe UI Semibold"){semibold=family.Name;break;}}catch {}
                }
                if(semibold.Length>0)return new Font(semibold,pixels,FontStyle.Regular,GraphicsUnit.Pixel);
                return new Font("Segoe UI",pixels,FontStyle.Bold,GraphicsUnit.Pixel);
            }
            // The static face: GDI+ draws the variable one thin and loosely spaced.
            return new Font("Segoe UI",pixels,FontStyle.Regular,GraphicsUnit.Pixel);
        }
        static float TextWidth(Graphics g,string text,Font font) {
            using(StringFormat format=(StringFormat)StringFormat.GenericTypographic.Clone()) {
                format.FormatFlags|=StringFormatFlags.MeasureTrailingSpaces;
                return g.MeasureString(text,font,10000,format).Width;
            }
        }
        static void Text(Graphics g,string text,Font font,Color color,RectangleF box,bool right=false) {
            using(SolidBrush brush=new SolidBrush(color))
            using(StringFormat format=(StringFormat)StringFormat.GenericTypographic.Clone()) {
                format.LineAlignment=StringAlignment.Center;format.Alignment=right?StringAlignment.Far:StringAlignment.Near;
                format.Trimming=StringTrimming.EllipsisCharacter;format.FormatFlags|=StringFormatFlags.NoWrap;
                g.DrawString(text,font,brush,box,format);
            }
        }
        // The icon set: a 20 x 20 grid, 1.5 stroke, round caps and joins. A
        // solid shape means the agent's state and nothing else, so only Stop
        // is filled. Drawn as paths; no font glyphs.
        internal static void Icon(Graphics g,string name,float x,float y,Color color,float scale=1) {
            var saved=g.Save();g.TranslateTransform(x+10,y+10);g.ScaleTransform(scale,scale);g.TranslateTransform(-10,-10);
            using(Pen pen=new Pen(color,1.5f)) {
                pen.StartCap=pen.EndCap=LineCap.Round;pen.LineJoin=LineJoin.Round;
                if(name=="stop") {
                    using(GraphicsPath square=Overlay.RoundRect(new RectangleF(4,4,12,12),3))using(SolidBrush fill=new SolidBrush(color))g.FillPath(fill,square);
                } else if(name=="settings") {
                    g.DrawLine(pen,2.75f,6.5f,10.25f,6.5f);g.DrawLine(pen,14.75f,6.5f,17.25f,6.5f);
                    g.DrawLine(pen,2.75f,13.5f,5.25f,13.5f);g.DrawLine(pen,9.75f,13.5f,17.25f,13.5f);
                    g.DrawEllipse(pen,10.25f,4.25f,4.5f,4.5f);g.DrawEllipse(pen,5.25f,11.25f,4.5f,4.5f);
                } else if(name=="close") {
                    g.DrawLine(pen,5.25f,5.25f,14.75f,14.75f);g.DrawLine(pen,14.75f,5.25f,5.25f,14.75f);
                } else if(name=="check") {
                    g.DrawLines(pen,new PointF[]{new PointF(4.75f,10.5f),new PointF(8.25f,14),new PointF(15.25f,6.25f)});
                } else if(name=="chevron") {
                    g.DrawLines(pen,new PointF[]{new PointF(7.5f,4.75f),new PointF(12.75f,10),new PointF(7.5f,15.25f)});
                }
            }
            g.Restore(saved);
        }
        static void Plate(Graphics g,Rectangle target,Color tint,float level,bool pressed) {
            if(level<=0&&!pressed)return;
            float alpha=(tint==Rose?.16f:.10f)*(pressed?1.5f:1)*Math.Max(level,pressed?1:0);
            using(SolidBrush plate=new SolidBrush(Color.FromArgb((int)(255*alpha),tint)))g.FillEllipse(plate,target.X+4,target.Y+4,36,36);
        }
        internal static void Hud(Graphics g,HudModel m) {
            g.SmoothingMode=SmoothingMode.AntiAlias;g.PixelOffsetMode=PixelOffsetMode.HighQuality;g.TextRenderingHint=System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
            Color surface=m.HighContrast?SystemColors.Window:InkSurface,strong=m.HighContrast?SystemColors.WindowText:PaperText,soft=m.HighContrast?SystemColors.WindowText:Mist,rest=m.HighContrast?SystemColors.WindowText:Rest;
            RectangleF panel=new RectangleF(0,0,HudWidth,HudHeight);
            // The pill is drawn, not cut: its edge is antialiased against whatever is behind it.
            using(GraphicsPath body=Overlay.RoundRect(panel,HudHeight/2f))using(SolidBrush fill=new SolidBrush(surface))g.FillPath(fill,body);
            using(GraphicsPath edge=Overlay.RoundRect(new RectangleF(.5f,.5f,HudWidth-1,HudHeight-1),HudHeight/2f))
            using(Pen border=new Pen(m.HighContrast?SystemColors.WindowText:Color.FromArgb(41,255,255,255),m.HighContrast?2:1))g.DrawPath(border,edge);
            float left=16;
            if(m.Icon!=null) {
                var mode=g.InterpolationMode;g.InterpolationMode=InterpolationMode.HighQualityBicubic;
                g.DrawImage(m.Icon,new RectangleF(12,12,24,24));g.InterpolationMode=mode;left=46;
            }
            float textRight=StopRect.Left-6;
            if(m.Hint) {
                // "Press [Esc] to stop": the key, directly before its mouse equivalent.
                using(Font small=Face(12,false))using(Font cap=Face(11,true)) {
                    float tail=TextWidth(g,"to stop",small),key=TextWidth(g,"Esc",cap)+12,lead=TextWidth(g,"Press",small);
                    float x=StopRect.Left-4-tail;
                    Text(g,"to stop",small,soft,new RectangleF(x,0,tail+2,HudHeight));
                    x-=6+key;
                    using(GraphicsPath keycap=Overlay.RoundRect(new RectangleF(x,14.5f,key,19),5))
                    using(Pen outline=new Pen(Color.FromArgb(102,strong),1))g.DrawPath(outline,keycap);
                    Text(g,"Esc",cap,strong,new RectangleF(x+6,14.5f,key-6,19));
                    x-=6+lead;
                    Text(g,"Press",small,soft,new RectangleF(x,0,lead+2,HudHeight));
                    textRight=x-10;
                }
            }
            // State is carried by the words, and by the colour of line 1.
            // There is no status dot.
            Color tone=m.HighContrast?SystemColors.WindowText:StateColor(m.State);
            using(Font first=Face(13,true))Text(g,m.Line1,first,tone,new RectangleF(left,7,textRight-left,18));
            using(Font second=Face(12,false))Text(g,m.Line2,second,Color.FromArgb((int)(255*Math.Max(0,Math.Min(1,m.TextIn))),soft),new RectangleF(left,25,textRight-left,16));
            if(m.Slot==1) {
                Plate(g,StopRect,Rose,m.StopHover,m.Pressed==2);
                Icon(g,"stop",StopRect.X+12,StopRect.Y+12,m.HighContrast?rest:Mix(rest,Rose,Math.Max(m.StopHover,m.Pressed==2?1:0)),m.Pressed==2&&MotionEnabled?.92f:1);
            } else if(m.Slot==2) {
                Plate(g,StopRect,Color.White,m.StopHover,m.Pressed==2);
                Icon(g,"close",StopRect.X+12,StopRect.Y+12,Mix(rest,strong,m.StopHover),m.Pressed==2&&MotionEnabled?.92f:1);
            }
            using(Pen divider=new Pen(Color.FromArgb(41,255,255,255),1))g.DrawLine(divider,391.5f,14,391.5f,34);
            Plate(g,ModeRect,Color.White,m.ModeHover,m.Pressed==3);
            Icon(g,"settings",ModeRect.X+12,ModeRect.Y+12,Mix(rest,strong,m.ModeHover),m.Pressed==3&&MotionEnabled?.92f:1);
        }
        internal static void Export(string directory) {
            Directory.CreateDirectory(directory);
            Color[] desks={Color.FromArgb(24,26,34),Color.FromArgb(244,246,249)};string[] deskNames={"dark","light"};
            for(int desk=0;desk<2;desk++)foreach(bool inside in new bool[]{false,true}) {
                int w=1200,h=760;
                using(Bitmap image=new Bitmap(w,h,PixelFormat.Format32bppArgb)) {
                    using(Graphics g=Graphics.FromImage(image)) {
                        g.SmoothingMode=SmoothingMode.AntiAlias;g.Clear(desks[desk]);
                        // A fictional desktop, never a capture of the user's data.
                        Rectangle app=inside?new Rectangle(0,0,w,h):new Rectangle(150,150,900,500);
                        using(SolidBrush panel=new SolidBrush(desk==0?Color.FromArgb(33,36,47):Color.White))g.FillRectangle(panel,app);
                        using(Font f=new Font(Overlay.UiFont,20))
                        using(SolidBrush ink=new SolidBrush(desk==0?Color.FromArgb(190,194,211):Color.FromArgb(60,66,80)))g.DrawString("Desktop control · visual preview",f,ink,app.X+40,app.Y+110);
                        GlowField field=new GlowField(app,new bool[]{inside,inside,inside,inside},1,inside?0:8,new Rectangle(0,0,w,h));
                        field.SetAction(app.X+app.Width*.25f,app.Bottom-40);field.Compose(0,1,1,null);field.Draw(g);
                        HudModel model=new HudModel();model.State="active";model.Line1="Antigravity is working";model.Line2="Clicking";model.Hint=true;model.Slot=1;
                        var state=g.Save();g.TranslateTransform((w-HudWidth)/2,18);
                        using(GraphicsPath pill=Overlay.RoundRect(new RectangleF(0,0,HudWidth,HudHeight),HudHeight/2f)){g.SetClip(pill);Hud(g,model);}
                        g.Restore(state);
                        state=g.Save();g.TranslateTransform(app.X+app.Width*.25f-48,app.Bottom-40-48);Pointer(g,0);g.TranslateTransform(44,46);Arrow(g);g.Restore(state);
                    }
                    image.Save(Path.Combine(directory,"desktop-"+deskNames[desk]+(inside?"-inside":"-outside")+".png"),ImageFormat.Png);
                }
            }
            string[][] states={
                new string[]{"active","Antigravity is working","Reading the screen · 1 min left","1","1"},
                new string[]{"active","Computer Use is working","Waiting for the next step","1","1"},
                new string[]{"asking","Waiting for your answer","Allow or deny below","1","1"},
                new string[]{"stopped","Stopped","You pressed Esc","0","2"},
                new string[]{"stopped","Stopped","Still releasing a key or button","0","0"},
                new string[]{"idle","Antigravity is ready","Not controlling anything","0","2"},
                new string[]{"idle","Session ended","The time limit ran out","0","2"},
            };
            using(Bitmap sheet=new Bitmap((HudWidth+40)*2,(HudHeight+24)*states.Length*2*2,PixelFormat.Format32bppArgb)) {
                using(Graphics g=Graphics.FromImage(sheet)) {
                    g.Clear(Color.FromArgb(60,64,72));g.ScaleTransform(2,2);
                    for(int hover=0;hover<2;hover++)for(int i=0;i<states.Length;i++) {
                        HudModel model=new HudModel();model.State=states[i][0];model.Line1=states[i][1];model.Line2=states[i][2];model.Hint=states[i][3]=="1";model.Slot=Int32.Parse(states[i][4]);
                        if(hover==1){model.StopHover=1;model.ModeHover=i%2;model.Pressed=i%3==0?2:0;}
                        var saved=g.Save();g.TranslateTransform(20,12+(HudHeight+24)*(i+hover*states.Length));
                        using(GraphicsPath pill=Overlay.RoundRect(new RectangleF(0,0,HudWidth,HudHeight),HudHeight/2f)){g.SetClip(pill);Hud(g,model);}
                        g.Restore(saved);
                    }
                }
                sheet.Save(Path.Combine(directory,"hud-states.png"),ImageFormat.Png);
            }
            foreach(uint role in new uint[]{32512,32513,32649,32650})
            using(Bitmap image=new Bitmap(96,96,PixelFormat.Format32bppArgb)) {
                using(Graphics g=Graphics.FromImage(image)){g.SmoothingMode=SmoothingMode.AntiAlias;g.ScaleTransform(3,3);NativeCursor(g,role);}
                image.Save(Path.Combine(directory,"cursor-"+role+".png"),ImageFormat.Png);
            }
            using(Bitmap image=new Bitmap(96,96,PixelFormat.Format32bppArgb)) {
                using(Graphics g=Graphics.FromImage(image)){g.SmoothingMode=SmoothingMode.AntiAlias;Pointer(g,0);}
                if(image.GetPixel(54,56).A<150)throw new Exception("The pointer glow is too faint to see");
                if(image.GetPixel(2,2).A!=0)throw new Exception("The pointer glow must end inside its surface");
                image.Save(Path.Combine(directory,"pointer-glow.png"),ImageFormat.Png);
            }
            // The glow may never cover the app. Inside: on the edge, fading
            // inward, gone within the band, never an opaque frame. Outside:
            // nothing at all drawn inside the window.
            using(Bitmap image=new Bitmap(800,600,PixelFormat.Format32bppArgb)) {
                using(Graphics g=Graphics.FromImage(image)) {
                    GlowField field=new GlowField(new Rectangle(0,0,800,600),new bool[]{true,true,true,true},1,0,new Rectangle(0,0,800,600));
                    field.SetAction(400,0);field.Compose(1,1,1,null);field.Draw(g);
                }
                if(image.GetPixel(400,300).A!=0)throw new Exception("Edge glow obscures desktop center");
                if(image.GetPixel(400,GlowField.InsideDepth+1).A!=0)throw new Exception("Inside glow must end within its band");
                if(image.GetPixel(400,5).A<=image.GetPixel(400,12).A)throw new Exception("Glow must fade inward");
                if(image.GetPixel(400,8).A>=210)throw new Exception("Glow became an opaque frame");
                if(image.GetPixel(400,1).A<200)throw new Exception("The glow line is too faint to see");
                image.Save(Path.Combine(directory,"edge-alpha-inside.png"),ImageFormat.Png);
            }
            using(Bitmap image=new Bitmap(800,600,PixelFormat.Format32bppArgb)) {
                using(Graphics g=Graphics.FromImage(image)) {
                    GlowField field=new GlowField(new Rectangle(100,100,600,400),new bool[]{false,false,false,false},1,8,new Rectangle(0,0,800,600));
                    field.SetAction(400,100);field.Compose(1,1,1,null);field.Draw(g);
                }
                if(image.GetPixel(400,300).A!=0||image.GetPixel(400,104).A!=0||image.GetPixel(104,300).A!=0)throw new Exception("Outside glow tints the app");
                if(image.GetPixel(400,90).A<=image.GetPixel(400,70).A)throw new Exception("Outside glow must fade away from the window");
                if(image.GetPixel(400,98).A<200)throw new Exception("The glow line is too faint to see");
                if(image.GetPixel(400,100-GlowField.OutsideDepth-1).A!=0)throw new Exception("Outside glow must end within its band");
                image.Save(Path.Combine(directory,"edge-alpha-outside.png"),ImageFormat.Png);
            }
            Console.WriteLine("Visual renders and alpha falloff checks passed.");
        }
    }
    // The glow around the app the agent is working in ("Ember"): a line on the
    // window's edge with a tight bloom and a wide haze over a deep shade, all
    // one hue. Every point of the edge is brighter the nearer it is to the
    // agent's last action, so the glow says where in the app it is working.
    //
    // The layers are baked once per geometry into four thin strips, one per
    // edge; a frame only multiplies them by one gain per point of the edge.
    // Each edge is drawn outside the window when there is room and inside it
    // when there is not (a maximised or full-screen app).
    internal sealed class GlowField {
        internal const int OutsideDepth=46,InsideDepth=22;   // DIPs the band reaches from the edge
        const int Lip=3;                                      // DIPs an outside strip overlaps the frame, for rounded corners
        static readonly double MinBright=ControlContract.UiNumber("glow_min",.36,0,1),Reach=ControlContract.UiNumber("glow_reach",.42,.05,4);
        static readonly double HazeOut=ControlContract.UiNumber("glow_haze_out",.66,0,1),HazeIn=ControlContract.UiNumber("glow_haze_in",.62,0,1);
        static readonly double HazeSigmaOut=ControlContract.UiNumber("glow_haze_sigma_out",17,2,40),HazeSigmaIn=ControlContract.UiNumber("glow_haze_sigma_in",7.5,1,20);
        static readonly double Lift=ControlContract.UiNumber("glow_lift",.55,0,2);
        internal readonly Rectangle Frame,Clip;internal readonly bool[] Inside;internal readonly float Scale;internal readonly int Radius;
        // Top, right, bottom, left, in screen pixels. An empty strip draws nothing.
        internal readonly Rectangle[] Strips=new Rectangle[4];
        internal readonly byte[][] Pixels=new byte[4][];
        readonly byte[][] field=new byte[4][],bloom=new byte[4][],flare=new byte[4][],core=new byte[4][],hair=new byte[4][];
        readonly int[][] index=new int[4][];
        readonly int perimeter;readonly float[] rest,gainField,gainLine,gainFlare,heat,visible;
        float actionX,actionY;int actionIndex;
        internal float ActionX {get {return actionX;}} internal float ActionY {get {return actionY;}}
        internal GlowField(Rectangle frame,bool[] inside,float scale,int radius,Rectangle clip) {
            Frame=frame;Inside=(bool[])inside.Clone();Scale=scale<=0?1:scale;Clip=clip;
            bool allOut=!inside[0]&&!inside[1]&&!inside[2]&&!inside[3];
            Radius=allOut?Math.Max(0,Math.Min(radius,Math.Min(frame.Width,frame.Height)/2)):0;
            int o=(int)Math.Ceiling(OutsideDepth*Scale),n=(int)Math.Ceiling(InsideDepth*Scale),lip=(int)Math.Ceiling(Lip*Scale);
            int l=frame.Left,t=frame.Top,r=frame.Right,b=frame.Bottom;
            n=Math.Min(n,Math.Min(frame.Width,frame.Height)/2);lip=Math.Min(lip,n);
            // Top and bottom own the corners; left and right fill between them.
            Strips[0]=inside[0]?Rectangle.FromLTRB(l,t,r,t+n):Rectangle.FromLTRB(l-o,t-o,r+o,t+lip);
            Strips[2]=inside[2]?Rectangle.FromLTRB(l,b-n,r,b):Rectangle.FromLTRB(l-o,b-lip,r+o,b+o);
            int top=inside[0]?t+n:t+lip,bottom=inside[2]?b-n:b-lip;
            Strips[3]=inside[3]?Rectangle.FromLTRB(l,top,l+n,bottom):Rectangle.FromLTRB(l-o,top,l+lip,bottom);
            Strips[1]=inside[1]?Rectangle.FromLTRB(r-n,top,r,bottom):Rectangle.FromLTRB(r-lip,top,r+o,bottom);
            for(int k=0;k<4;k++) {Strips[k]=Rectangle.Intersect(Strips[k],clip);if(Strips[k].Width<=0||Strips[k].Height<=0)Strips[k]=Rectangle.Empty;}
            perimeter=Math.Max(1,2*(frame.Width+frame.Height));
            rest=new float[perimeter];gainField=new float[perimeter];gainLine=new float[perimeter];gainFlare=new float[perimeter];heat=new float[perimeter];visible=new float[perimeter];
            Bake();SetAction(frame.Left+frame.Width/2f,frame.Top+frame.Height/2f);
        }
        static double Gauss(double distance,double sigma) {return Math.Exp(-(distance/sigma)*(distance/sigma));}
        static double Line(double distance,double centre,double half) {return Math.Max(0,Math.Min(1,half+.5-Math.Abs(distance-centre)));}
        // Position along the edge, clockwise from the top-left corner.
        int EdgeIndex(int edge,int x,int y) {
            int w=Frame.Width,h=Frame.Height;
            x=Math.Max(Frame.Left,Math.Min(Frame.Right-1,x));y=Math.Max(Frame.Top,Math.Min(Frame.Bottom-1,y));
            return edge==0?x-Frame.Left:edge==1?w+(y-Frame.Top):edge==2?w+h+(Frame.Right-1-x):2*w+h+(Frame.Bottom-1-y);
        }
        void EdgePoint(int i,out float x,out float y) {
            int w=Frame.Width,h=Frame.Height;
            if(i<w){x=Frame.Left+i;y=Frame.Top;}
            else if(i<w+h){x=Frame.Right;y=Frame.Top+(i-w);}
            else if(i<2*w+h){x=Frame.Right-(i-w-h);y=Frame.Bottom;}
            else {x=Frame.Left;y=Frame.Bottom-(i-2*w-h);}
        }
        void Bake() {
            double s=Scale;int l=Frame.Left,t=Frame.Top,r=Frame.Right,b=Frame.Bottom;
            double cx=(l+r)/2.0,cy=(t+b)/2.0,hw=Frame.Width/2.0,hh=Frame.Height/2.0;
            for(int k=0;k<4;k++) {
                Rectangle strip=Strips[k];int count=strip.Width*strip.Height;
                Pixels[k]=new byte[count*4];field[k]=new byte[count*4];bloom[k]=new byte[count];flare[k]=new byte[count];core[k]=new byte[count];hair[k]=new byte[count];index[k]=new int[count];
                for(int yy=0;yy<strip.Height;yy++)for(int xx=0;xx<strip.Width;xx++) {
                    int at=yy*strip.Width+xx,x=strip.Left+xx,y=strip.Top+yy;index[k][at]=-1;
                    double px=x+.5,py=y+.5,distance;bool inner;int edge;
                    double dx=Math.Max(Math.Max(l-px,px-r),0),dy=Math.Max(Math.Max(t-py,py-b),0);
                    if(Radius>0) {
                        // Signed distance to the rounded frame.
                        double qx=Math.Abs(px-cx)-(hw-Radius),qy=Math.Abs(py-cy)-(hh-Radius);
                        distance=Math.Sqrt(Math.Max(qx,0)*Math.Max(qx,0)+Math.Max(qy,0)*Math.Max(qy,0))+Math.Min(Math.Max(qx,qy),0)-Radius;
                        if(distance<0)continue;
                        inner=false;edge=py<t?0:py>=b?2:px<l?3:px>=r?1:(Math.Min(py-t,b-py)<Math.Min(px-l,r-px)?(py-t<b-py?0:2):(px-l<r-px?3:1));
                    } else if(dx>0||dy>0) {
                        int horizontal=px<l?3:1,vertical=py<t?0:2;
                        if(dx>0&&dy>0) {if(Inside[horizontal]||Inside[vertical])continue;distance=Math.Sqrt(dx*dx+dy*dy);edge=dy>=dx?vertical:horizontal;}
                        else if(dx>0) {if(Inside[horizontal])continue;distance=dx;edge=horizontal;}
                        else {if(Inside[vertical])continue;distance=dy;edge=vertical;}
                        inner=false;
                    } else {
                        distance=Double.MaxValue;edge=-1;
                        double[] depth={py-t,r-px,b-py,px-l};
                        for(int e=0;e<4;e++)if(Inside[e]&&depth[e]<distance){distance=depth[e];edge=e;}
                        if(edge<0)continue;
                        inner=true;
                    }
                    double u=distance/s;   // DIPs from the edge
                    double shade,haze,glowBloom,glowFlare,coreLine,hairLine;
                    if(inner) {
                        if(u>InsideDepth)continue;
                        double fade=Math.Min(1,(InsideDepth-u)/4);   // reaches zero at the band's end
                        shade=.34*Gauss(u,3);haze=HazeIn*Gauss(u,HazeSigmaIn)*fade;
                        glowBloom=.95*Gauss(u-1,3.4)*fade;glowFlare=Gauss(u-1,4.6)*fade;
                        coreLine=Line(distance,1*s,1*s);hairLine=.6*Line(distance,2.8*s,.5);
                    } else {
                        if(u>OutsideDepth)continue;
                        double fade=Math.Min(1,(OutsideDepth-u)/6);
                        shade=.46*Gauss(u,5.5);haze=HazeOut*Gauss(u-2,HazeSigmaOut)*fade;
                        glowBloom=Gauss(u-2,4.4)*fade;glowFlare=Gauss(u-2,7)*fade;
                        coreLine=Line(distance,2*s,1*s);hairLine=Math.Max(.9*Line(distance,.4*s,.5),.55*Line(distance,3.8*s,.5));
                    }
                    // Dither the haze, so its falloff does not band on 8-bit displays.
                    uint hash=(uint)(x*73856093)^(uint)(y*19349663);hash^=hash>>13;hash*=0x5bd1e995;hash^=hash>>15;
                    haze=Math.Max(0,haze+((hash&1023)/1023.0-.5)*.012*(haze>.004?1:0));
                    // The field: haze over shade, premultiplied.
                    double alpha=haze+shade*(1-haze);
                    field[k][at*4]=(byte)Math.Round(255*(DesktopVisuals.GlowHaze.B/255.0*haze+DesktopVisuals.GlowShade.B/255.0*shade*(1-haze)));
                    field[k][at*4+1]=(byte)Math.Round(255*(DesktopVisuals.GlowHaze.G/255.0*haze+DesktopVisuals.GlowShade.G/255.0*shade*(1-haze)));
                    field[k][at*4+2]=(byte)Math.Round(255*(DesktopVisuals.GlowHaze.R/255.0*haze+DesktopVisuals.GlowShade.R/255.0*shade*(1-haze)));
                    field[k][at*4+3]=(byte)Math.Round(255*alpha);
                    bloom[k][at]=(byte)Math.Round(255*Math.Min(1,glowBloom));flare[k][at]=(byte)Math.Round(255*Math.Min(1,glowFlare));
                    core[k][at]=(byte)Math.Round(255*coreLine);hair[k][at]=(byte)Math.Round(255*hairLine);
                    index[k][at]=EdgeIndex(edge,x,y);
                }
            }
        }
        // Where the agent last acted, in screen pixels. The edge is brightest
        // nearest this point and cools away from it.
        internal void SetAction(float x,float y) {
            actionX=x;actionY=y;
            double reach=Reach*Math.Sqrt((double)Frame.Width*Frame.Width+(double)Frame.Height*Frame.Height);
            double best=Double.MaxValue;
            for(int i=0;i<perimeter;i++) {
                float ex,ey;EdgePoint(i,out ex,out ey);
                double d=Math.Sqrt((ex-x)*(ex-x)+(ey-y)*(ey-y));
                if(d<best){best=d;actionIndex=i;}
                rest[i]=(float)(MinBright+(1-MinBright)*Gauss(d,reach));
            }
        }
        // lift 0..1 raises bloom and haze as a whole; haze 0..1 fades the
        // field; reveal 0..1 draws the line on from the action point; each
        // pulse 0..1 is one swell travelling away from it, both ways.
        internal void Compose(float lift,float haze,float reveal,float[] pulses) {
            double travel=.48*perimeter/2.0,width=64*Scale,raise=1+Lift*Math.Max(0,Math.Min(1,lift));
            for(int i=0;i<perimeter;i++) {
                double d=Math.Abs(i-actionIndex);d=Math.Min(d,perimeter-d);
                double bright=rest[i],shown=1;
                if(pulses!=null)foreach(float q in pulses) {
                    if(q<0||q>=1)continue;
                    double k=(d-travel*DesktopVisuals.EaseOut(q))/width;bright+=.9*Math.Exp(-k*k)*(1-DesktopVisuals.EaseIn(q));
                }
                if(reveal<1) {
                    double front=reveal*perimeter/2.0,k=(d-front)/(16*Scale);
                    shown=Math.Max(0,Math.Min(1,(front-d)/(8*Scale)+1));bright+=.9*Math.Exp(-k*k)*shown;
                }
                gainField[i]=(float)((.42+.58*rest[i])*raise*haze);
                gainLine[i]=(float)(shown*(.42+.58*bright)*raise);
                gainFlare[i]=(float)(shown*Math.Min(1,(bright-rest[i])*.85));
                heat[i]=(float)(shown*Math.Min(1,.7*Math.Pow(Math.Min(1,rest[i]),1.5)+(bright-rest[i])));
                visible[i]=(float)shown;
            }
            Color cool=DesktopVisuals.GlowCool,hot=DesktopVisuals.GlowHot,bloomColor=DesktopVisuals.GlowBloom,flareColor=DesktopVisuals.GlowFlare,slate=DesktopVisuals.Slate;
            for(int k=0;k<4;k++) {
                byte[] output=Pixels[k],f=field[k],bl=bloom[k],fl=flare[k],co=core[k],ha=hair[k];int[] ix=index[k];
                for(int at=0;at<ix.Length;at++) {
                    int o=at*4,i=ix[at];
                    if(i<0){output[o]=output[o+1]=output[o+2]=output[o+3]=0;continue;}
                    // Premultiplied "over", bottom to top: field, bloom, flare, hairline, core.
                    float g=gainField[i];
                    float pb=Math.Min(255,f[o]*g),pg=Math.Min(255,f[o+1]*g),pr=Math.Min(255,f[o+2]*g),pa=Math.Min(255,f[o+3]*g);
                    float a=Math.Min(1,bl[at]/255f*gainLine[i]);
                    if(a>0){pb=bloomColor.B*a+pb*(1-a);pg=bloomColor.G*a+pg*(1-a);pr=bloomColor.R*a+pr*(1-a);pa=255*a+pa*(1-a);}
                    a=fl[at]/255f*gainFlare[i];
                    if(a>0){pb=flareColor.B*a+pb*(1-a);pg=flareColor.G*a+pg*(1-a);pr=flareColor.R*a+pr*(1-a);pa=255*a+pa*(1-a);}
                    float warmth=heat[i],seen=visible[i];
                    if(seen>0) {
                        a=ha[at]/255f*seen;
                        if(a>0){pb=slate.B*a+pb*(1-a);pg=slate.G*a+pg*(1-a);pr=slate.R*a+pr*(1-a);pa=255*a+pa*(1-a);}
                        a=co[at]/255f*seen;
                        if(a>0) {
                            float cb=cool.B+(hot.B-cool.B)*warmth,cg=cool.G+(hot.G-cool.G)*warmth,cr=cool.R+(hot.R-cool.R)*warmth;
                            pb=cb*a+pb*(1-a);pg=cg*a+pg*(1-a);pr=cr*a+pr*(1-a);pa=255*a+pa*(1-a);
                        }
                    }
                    output[o]=(byte)pb;output[o+1]=(byte)pg;output[o+2]=(byte)pr;output[o+3]=(byte)pa;
                }
            }
        }
        // Renders the composed strips onto a surface whose origin is screen (0,0).
        internal void Draw(Graphics g) {
            for(int k=0;k<4;k++) {
                Rectangle strip=Strips[k];if(strip.IsEmpty)continue;
                using(Bitmap image=new Bitmap(strip.Width,strip.Height,PixelFormat.Format32bppPArgb)) {
                    BitmapData data=image.LockBits(new Rectangle(0,0,strip.Width,strip.Height),ImageLockMode.WriteOnly,PixelFormat.Format32bppPArgb);
                    try {Marshal.Copy(Pixels[k],0,data.Scan0,Pixels[k].Length);}finally {image.UnlockBits(data);}
                    g.DrawImageUnscaled(image,strip.X,strip.Y);
                }
            }
        }
    }
}
