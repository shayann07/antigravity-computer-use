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
        internal static Color StateColor(string state) {
            return state=="paused"||state=="asking" ? Amber : state=="stopped" ? Rose : state=="active" ? Violet : Rest;
        }
        static Color Mix(Color a,Color b,float t) {t=Math.Max(0,Math.Min(1,t));return Color.FromArgb((int)(a.A+(b.A-a.A)*t),(int)(a.R+(b.R-a.R)*t),(int)(a.G+(b.G-a.G)*t),(int)(a.B+(b.B-a.B)*t));}
        // The agent's pointer wears the same light as the window it works in:
        // a wide haze, a tight bloom and a hot centre, sitting behind the
        // arrow Windows draws. The hotspot is (48,48) on a 96 x 96 surface.
        internal static void Pointer(Graphics g,float phase) {
            PointF centre=new PointF(54,56);
            Color tone=GlowTones.ColorAt(0);
            Halo(g,centre,38,tone,96);
            Halo(g,centre,18,Mix(tone,Color.White,.5f),128);
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
            using(Pen bloom=new Pen(Color.FromArgb((int)(120*(1-t)),GlowTones.ColorAt(0)),5f))g.DrawEllipse(bloom,48-radius,48-radius,2*radius,2*radius);
            using(Pen core=new Pen(Color.FromArgb((int)(235*(1-t)),Mix(GlowTones.ColorAt(0),Color.White,.6f)),1.6f))g.DrawEllipse(core,48-radius,48-radius,2*radius,2*radius);
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
        // ---- The Settings menu: a raised panel under the bar. A header that
        // says whose menu it is, 44-high rows, a hairline, and a footer that
        // repeats how to stop.
        internal const int MenuWidth=312,MenuMargin=36;   // the margin holds the panel's shadow
        internal sealed class MenuItem {
            internal int Id;internal string Kind="row";   // head, row, rule, foot
            internal string Text="",Note="";internal bool Ticks,Checked,Chevron;
            internal RectangleF Bounds;
        }
        // Places the items; returns the panel's height.
        internal static float MenuLayout(System.Collections.Generic.List<MenuItem> items) {
            float y=6;
            foreach(MenuItem item in items) {
                float height=item.Kind=="head"?30:item.Kind=="rule"?13:item.Kind=="foot"?58:44;
                item.Bounds=new RectangleF(6,y,MenuWidth-12,height);y+=height;
            }
            return y+6;
        }
        static float KeyCap(Graphics g,string key,float x,float y,Font cap,Color strong) {
            float width=TextWidth(g,key,cap)+12;
            using(GraphicsPath shape=Overlay.RoundRect(new RectangleF(x,y,width,20),5))using(Pen outline=new Pen(Color.FromArgb(102,strong),1))g.DrawPath(outline,shape);
            Text(g,key,cap,strong,new RectangleF(x+6,y,width-6,20));
            return x+width;
        }
        // Drawn with its own margin, so the panel's shadow is part of the surface.
        internal static void Menu(Graphics g,System.Collections.Generic.List<MenuItem> items,float height,int hover,int pressed) {
            g.SmoothingMode=SmoothingMode.AntiAlias;g.PixelOffsetMode=PixelOffsetMode.HighQuality;g.TextRenderingHint=System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
            RectangleF panel=new RectangleF(MenuMargin,MenuMargin,MenuWidth,height);
            // One neutral drop shadow: 0 12 28, black 34%.
            for(int i=14;i>=1;i--) {
                RectangleF soft=panel;soft.Offset(0,12);soft.Inflate(i*2-6,i*2-6);
                using(GraphicsPath shape=Overlay.RoundRect(soft,12+i*2))using(SolidBrush shade=new SolidBrush(Color.FromArgb(7,0,0,0)))g.FillPath(shade,shape);
            }
            using(GraphicsPath shape=Overlay.RoundRect(panel,12)) {
                using(SolidBrush fill=new SolidBrush(InkRaised))g.FillPath(fill,shape);
                using(Pen edge=new Pen(Color.FromArgb(41,255,255,255),1))g.DrawPath(edge,shape);
            }
            using(Font body=Face(13,false))using(Font small=Face(12,false))using(Font cap=Face(11,true))
            foreach(MenuItem item in items) {
                RectangleF box=item.Bounds;box.Offset(MenuMargin,MenuMargin);
                if(item.Kind=="head")Text(g,item.Text,small,Mist,new RectangleF(box.X+12,box.Y+6,box.Width-24,20));
                else if(item.Kind=="rule")using(Pen rule=new Pen(Color.FromArgb(26,255,255,255),1))g.DrawLine(rule,box.X+8,box.Y+6.5f,box.Right-8,box.Y+6.5f);
                else if(item.Kind=="foot") {
                    // "Esc or Ctrl Alt F12 stops at once", with the keys as keys.
                    float x=box.X+12,y=box.Y+8;
                    x=KeyCap(g,"Esc",x,y,cap,PaperText)+5;
                    float or=TextWidth(g,"or",small);Text(g,"or",small,Mist,new RectangleF(x,y,or+2,20));x+=or+5;
                    foreach(string key in new string[]{"Ctrl","Alt","F12"})x=KeyCap(g,key,x,y,cap,PaperText)+4;
                    Text(g,"stops at once.",small,Mist,new RectangleF(x+1,y,box.Right-x-8,20));
                    Text(g,"Your own mouse and keyboard don't pause it.",small,Mist,new RectangleF(box.X+12,y+22,box.Width-24,20));
                } else {
                    if(item.Id==pressed||item.Id==hover)
                        using(GraphicsPath plate=Overlay.RoundRect(box,8))using(SolidBrush fill=new SolidBrush(Color.FromArgb(item.Id==pressed?36:22,255,255,255)))g.FillPath(fill,plate);
                    float left=box.X+12;
                    if(item.Ticks){if(item.Checked)Icon(g,"check",left,box.Y+12,Violet);left+=30;}
                    float right=box.Right-12;
                    if(item.Chevron){Icon(g,"chevron",right-18,box.Y+12,Rest);right-=22;}
                    if(item.Note.Length>0){float note=TextWidth(g,item.Note,small);Text(g,item.Note,small,Mist,new RectangleF(right-note-2,box.Y,note+4,box.Height));right-=note+10;}
                    Text(g,item.Text,body,PaperText,new RectangleF(left,box.Y,right-left,box.Height));
                }
            }
        }
        // ---- The bench. Everything below renders previews for review and
        // checks them; none of it runs in the product.
        // A fictional app, never a capture of the user's data: a title bar,
        // a sidebar, rows of text and a scrollbar, so the glow is judged
        // against the things it must not spoil.
        static Bitmap Backdrop(int w,int h,bool dark,Rectangle app) {
            Bitmap image=new Bitmap(w,h,PixelFormat.Format32bppArgb);
            using(Graphics g=Graphics.FromImage(image)) {
                g.SmoothingMode=SmoothingMode.AntiAlias;g.TextRenderingHint=System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
                g.Clear(dark?Color.FromArgb(16,18,24):Color.FromArgb(226,231,238));
                Color panel=dark?Color.FromArgb(31,33,40):Color.White,bar=dark?Color.FromArgb(24,26,32):Color.FromArgb(243,245,248),ink=dark?Color.FromArgb(214,218,228):Color.FromArgb(40,46,58),faint=dark?Color.FromArgb(120,126,140):Color.FromArgb(120,128,142),line=dark?Color.FromArgb(44,47,56):Color.FromArgb(226,230,236);
                using(SolidBrush fill=new SolidBrush(panel))g.FillRectangle(fill,app);
                using(SolidBrush fill=new SolidBrush(bar)){g.FillRectangle(fill,app.X,app.Y,app.Width,38);g.FillRectangle(fill,app.X,app.Y+38,190,app.Height-38);}
                using(Pen rule=new Pen(line)){g.DrawLine(rule,app.X,app.Y+38,app.Right,app.Y+38);g.DrawLine(rule,app.X+190,app.Y+38,app.X+190,app.Bottom);}
                using(Font small=new Font("Segoe UI",12,FontStyle.Regular,GraphicsUnit.Pixel))using(Font body=new Font("Segoe UI",14,FontStyle.Regular,GraphicsUnit.Pixel))using(Font head=new Font("Segoe UI Semibold",20,FontStyle.Regular,GraphicsUnit.Pixel))
                using(SolidBrush strong=new SolidBrush(ink))using(SolidBrush soft=new SolidBrush(faint)) {
                    g.DrawString("Ledger — Invoices, November",small,strong,app.X+14,app.Y+11);
                    g.DrawString("—    ▢    ✕",small,soft,app.Right-92,app.Y+11);
                    string[] side={"Overview","Invoices","Customers","Reports","Settings"};
                    for(int i=0;i<side.Length;i++)g.DrawString(side[i],body,i==1?strong:soft,app.X+18,app.Y+60+i*34);
                    g.DrawString("Invoices",head,strong,app.X+214,app.Y+58);
                    string[] rows={"4471   Brightwell Cycles        14 Nov        Paid          1,284.00","4472   Harbour & Finch          14 Nov        Due           640.50","4473   Northgate Print          15 Nov        Due           2,019.75","4474   Calder Works             15 Nov        Draft         318.00","4475   Lindqvist Studio         16 Nov        Paid          975.20","4476   Okafor Supply            16 Nov        Due           1,450.00"};
                    for(int i=0;i<12;i++) {
                        int y=app.Y+104+i*36;if(y>app.Bottom-30)break;
                        using(Pen rule=new Pen(line))g.DrawLine(rule,app.X+214,y+28,app.Right-30,y+28);
                        g.DrawString(rows[i%rows.Length],body,i%3==0?strong:soft,app.X+214,y+4);
                    }
                }
                using(SolidBrush thumb=new SolidBrush(dark?Color.FromArgb(78,82,94):Color.FromArgb(190,196,206)))g.FillRectangle(thumb,app.Right-10,app.Y+60,6,120);
            }
            return image;
        }
        // Lays glow strips over a picture the way the desktop would.
        static void Lay(Bitmap image,params GlowField[] fields) {
            Rectangle all=new Rectangle(0,0,image.Width,image.Height);int[] pixels=new int[image.Width*image.Height];
            BitmapData data=image.LockBits(all,ImageLockMode.ReadWrite,PixelFormat.Format32bppArgb);
            try {
                Marshal.Copy(data.Scan0,pixels,0,pixels.Length);
                foreach(GlowField field in fields)field.Over(pixels,image.Width,image.Height);
                Marshal.Copy(pixels,0,data.Scan0,pixels.Length);
            } finally {image.UnlockBits(data);}
        }
        static GlowField[] Glow(Rectangle app,bool inside,Rectangle clip,float x,float y,double time,float lift,float[] pulses) {
            bool[] sides={inside,inside,inside,inside};
            GlowField veil=new GlowField(GlowField.Veil,app,sides,1,inside?0:8,clip),edge=new GlowField(GlowField.Edge,app,sides,1,inside?0:8,clip);
            veil.SetAction(x,y);edge.SetAction(x,y);veil.Compose(time,lift,1,pulses);edge.Compose(time,lift,1,pulses);
            return new GlowField[]{veil,edge};
        }
        static void Crop(Bitmap source,Rectangle part,Bitmap sheet,int x,int y) {using(Graphics g=Graphics.FromImage(sheet))g.DrawImage(source,new Rectangle(x,y,part.Width,part.Height),part,GraphicsUnit.Pixel);}
        static int AlphaAt(int[] pixels,int width,int x,int y) {return (pixels[y*width+x]>>24)&255;}
        internal static void Export(string directory) {
            Directory.CreateDirectory(directory);
            int w=1280,h=800;Rectangle screen=new Rectangle(0,0,w,h),window=new Rectangle(190,140,900,520);
            foreach(string host in new string[]{"Antigravity","Claude","Computer Use"}) {
                GlowTones.Use(host);string tag=host.Replace(" ","").ToLowerInvariant();
                foreach(bool dark in new bool[]{true,false}) {
                    // Maximised: lit inside. At full size: a corner, the edge by the action, the far edge.
                    using(Bitmap image=Backdrop(w,h,dark,screen))using(Bitmap sheet=new Bitmap(1200,400,PixelFormat.Format32bppArgb)) {
                        Lay(image,Glow(screen,true,screen,300,h-60,4.0,0,null));
                        image.Save(Path.Combine(directory,"glow-"+tag+"-inside-"+(dark?"dark":"light")+".png"),ImageFormat.Png);
                        Crop(image,new Rectangle(0,h-400,400,400),sheet,0,0);Crop(image,new Rectangle(0,0,400,400),sheet,400,0);Crop(image,new Rectangle(w-400,200,400,400),sheet,800,0);
                        sheet.Save(Path.Combine(directory,"close-"+tag+"-inside-"+(dark?"dark":"light")+".png"),ImageFormat.Png);
                    }
                    // Windowed: lit outside.
                    using(Bitmap image=Backdrop(w,h,dark,window))using(Bitmap sheet=new Bitmap(1200,400,PixelFormat.Format32bppArgb)) {
                        Lay(image,Glow(window,false,screen,window.X+240,window.Bottom-60,4.0,0,null));
                        image.Save(Path.Combine(directory,"glow-"+tag+"-outside-"+(dark?"dark":"light")+".png"),ImageFormat.Png);
                        Crop(image,new Rectangle(window.X-110,window.Bottom-290,400,400),sheet,0,0);Crop(image,new Rectangle(window.X-110,window.Y-110,400,400),sheet,400,0);Crop(image,new Rectangle(window.Right-290,window.Y+60,400,400),sheet,800,0);
                        sheet.Save(Path.Combine(directory,"close-"+tag+"-outside-"+(dark?"dark":"light")+".png"),ImageFormat.Png);
                    }
                }
                // Motion: the same stretch of the bottom edge, half a second apart, then a click landing.
                using(Bitmap sheet=new Bitmap(1200,480,PixelFormat.Format32bppArgb)) {
                    for(int i=0;i<6;i++)using(Bitmap image=Backdrop(w,h,true,screen)) {
                        Lay(image,Glow(screen,true,screen,300,h-60,4.0+i*.5,0,null));Crop(image,new Rectangle(200,h-240,200,240),sheet,i*200,0);
                    }
                    for(int i=0;i<6;i++)using(Bitmap image=Backdrop(w,h,true,screen)) {
                        float q=i/6f;Lay(image,Glow(screen,true,screen,300,h-60,7.0+q*.3,q<.4f?q/.4f:1,new float[]{q}));Crop(image,new Rectangle(200,h-240,200,240),sheet,i*200,240);
                    }
                    sheet.Save(Path.Combine(directory,"motion-"+tag+".png"),ImageFormat.Png);
                }
                using(Bitmap image=new Bitmap(288,288,PixelFormat.Format32bppArgb)) {
                    using(Graphics g=Graphics.FromImage(image)){g.Clear(Color.FromArgb(31,33,40));g.SmoothingMode=SmoothingMode.AntiAlias;g.ScaleTransform(3,3);Pointer(g,0);g.TranslateTransform(44,46);Arrow(g);}
                    image.Save(Path.Combine(directory,"pointer-"+tag+".png"),ImageFormat.Png);
                }
            }
            GlowTones.Use("Antigravity");
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
                        var saved=g.Save();g.TranslateTransform(20,12+(HudHeight+24)*(i+hover*states.Length));Hud(g,model);g.Restore(saved);
                    }
                }
                sheet.Save(Path.Combine(directory,"hud-states.png"),ImageFormat.Png);
            }
            {
                var items=new System.Collections.Generic.List<MenuItem>();
                MenuItem head=new MenuItem();head.Kind="head";head.Text="Computer Use";items.Add(head);
                MenuItem record=new MenuItem();record.Id=1;record.Text="Show bar and glow in recordings";record.Ticks=true;record.Checked=true;items.Add(record);
                MenuItem move=new MenuItem();move.Id=2;move.Text="Move bar";move.Note="Top centre";move.Chevron=true;items.Add(move);
                MenuItem rule=new MenuItem();rule.Kind="rule";items.Add(rule);
                MenuItem foot=new MenuItem();foot.Kind="foot";items.Add(foot);
                float tall=MenuLayout(items);
                using(Bitmap image=new Bitmap((MenuWidth+2*MenuMargin)*2,(int)((tall+2*MenuMargin)*2),PixelFormat.Format32bppArgb)) {
                    using(Graphics g=Graphics.FromImage(image)){g.Clear(Color.FromArgb(31,33,40));g.ScaleTransform(2,2);Menu(g,items,tall,2,0);}
                    image.Save(Path.Combine(directory,"menu.png"),ImageFormat.Png);
                }
            }
            foreach(uint role in new uint[]{32512,32513,32649,32650})
            using(Bitmap image=new Bitmap(96,96,PixelFormat.Format32bppArgb)) {
                using(Graphics g=Graphics.FromImage(image)){g.SmoothingMode=SmoothingMode.AntiAlias;g.ScaleTransform(3,3);NativeCursor(g,role);}
                image.Save(Path.Combine(directory,"cursor-"+role+".png"),ImageFormat.Png);
            }
            using(Bitmap image=new Bitmap(96,96,PixelFormat.Format32bppArgb)) {
                using(Graphics g=Graphics.FromImage(image)){g.SmoothingMode=SmoothingMode.AntiAlias;Pointer(g,0);}
                if(image.GetPixel(54,56).A<130)throw new Exception("The pointer glow is too faint to see");
                if(image.GetPixel(2,2).A!=0)throw new Exception("The pointer glow must end inside its surface");
            }
            // What the glow may never do, checked at its strongest (a click
            // landing right at the point tested).
            int[] clear=new int[800*700];
            foreach(GlowField field in Glow(new Rectangle(0,0,800,700),true,new Rectangle(0,0,800,700),400,0,4,1,new float[]{.2f}))field.Over(clear,800,700);
            if(AlphaAt(clear,800,400,350)!=0)throw new Exception("The glow covers the middle of the app");
            if(AlphaAt(clear,800,400,GlowField.Reach(GlowField.Veil,1)+2)!=0)throw new Exception("The inside glow must end within its reach");
            if(AlphaAt(clear,800,400,1)<170)throw new Exception("The glow is too faint to see at the edge");
            if(AlphaAt(clear,800,400,4)<=AlphaAt(clear,800,400,14)||AlphaAt(clear,800,400,14)<=AlphaAt(clear,800,400,40))throw new Exception("The glow must fade inward");
            if(AlphaAt(clear,800,400,72)>=96)throw new Exception("The glow fogs the app beyond its band");
            clear=new int[800*700];
            foreach(GlowField field in Glow(new Rectangle(100,150,600,400),false,new Rectangle(0,0,800,700),400,150,4,1,new float[]{.2f}))field.Over(clear,800,700);
            if(AlphaAt(clear,800,400,350)!=0)throw new Exception("The glow covers the middle of the app");
            if(AlphaAt(clear,800,400,156)>=40||AlphaAt(clear,800,106,350)>=40)throw new Exception("The outside glow tints the app");
            if(AlphaAt(clear,800,400,148)<170)throw new Exception("The glow is too faint to see at the edge");
            if(AlphaAt(clear,800,400,146)<=AlphaAt(clear,800,400,130))throw new Exception("The outside glow must fade away from the window");
            if(AlphaAt(clear,800,400,150-GlowField.Reach(GlowField.Veil,0)-2)!=0)throw new Exception("The outside glow must end within its reach");
            Console.WriteLine("Visual renders and glow checks passed.");
        }
    }
}
