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
        // button.press: how long a press takes to land, and how far it goes.
        internal const int Press=160;internal const float PressScale=.97f;
        // menu.open: the panel grows from this share of its size.
        internal const float MenuFrom=.96f;
        // bar.settle: one gentle spring. Seconds to settle, and how much it overshoots.
        internal const double SpringSeconds=.45,SpringBounce=.15;
        // How it is solved: a fixed step and the longest stretch taken at once
        // (seconds); at rest within SpringNear px moving under SpringSlow px a
        // second; let go at the speed of the drag's last SpringTrail ms.
        internal const double SpringStep=.001,SpringLongest=.064,SpringNear=.5,SpringSlow=20;internal const int SpringTrail=80;
        // The glow's slow life, in seconds: one lap of colour, one swell of
        // the band, one wander of the colours. And its frame times, in
        // milliseconds: in a transition, at rest, and for the deep wash.
        internal const double GlowLap=60,GlowBreath=7,GlowWander=13;
        internal const int GlowFrame=16,GlowRestFrame=66,GlowVeilFrame=1000;
        // Entering and leaving ease out: quick to answer, gentle to settle.
        // Moving on screen eases in and out. Both are strong curves.
        static readonly float[] OutCurve=Curve(.23,1,.32,1),InOutCurve=Curve(.77,0,.175,1);
        static float[] Curve(double x1,double y1,double x2,double y2) {
            float[] table=new float[257];
            for(int i=0;i<=256;i++) {
                // Solve the curve's x for its parameter, then read y.
                double x=i/256.0,p=x;
                for(int n=0;n<8;n++) {
                    double at=3*(1-p)*(1-p)*p*x1+3*(1-p)*p*p*x2+p*p*p-x,slope=3*(1-p)*(1-p)*x1+6*(1-p)*p*(x2-x1)+3*p*p*(1-x2);
                    if(Math.Abs(slope)<1e-6)break;
                    p=Math.Max(0,Math.Min(1,p-at/slope));
                }
                table[i]=(float)(3*(1-p)*(1-p)*p*y1+3*(1-p)*p*p*y2+p*p*p);
            }
            table[0]=0;table[256]=1;return table;
        }
        static float Read(float[] table,float t) {t=Math.Max(0,Math.Min(1,t))*256;int i=Math.Min(255,(int)t);return table[i]+(table[i+1]-table[i])*(t-i);}
        internal static float EaseOut(float t) {return Read(OutCurve,t);}
        internal static float EaseInOut(float t) {return Read(InOutCurve,t);}
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
            Halo(g,centre,38,tone,78);
            Halo(g,centre,18,Mix(tone,Color.White,.35f),104);
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
            internal float StopHover,ModeHover;  // 0..1
            internal float StopPress,ModePress;  // 0..1, how far a press has landed
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
        // button.press: the icon's size for a press that has landed this far.
        static float Pressing(float level) {return 1-(1-PressScale)*Math.Max(0,Math.Min(1,level));}
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
            using(Font second=Face(12,false))Text(g,m.Line2,second,soft,new RectangleF(left,25,textRight-left,16));
            if(m.Slot==1) {
                Plate(g,StopRect,Rose,m.StopHover,m.Pressed==2);
                Icon(g,"stop",StopRect.X+12,StopRect.Y+12,m.HighContrast?rest:Mix(rest,Rose,Math.Max(m.StopHover,m.Pressed==2?1:0)),Pressing(m.StopPress));
            } else if(m.Slot==2) {
                Plate(g,StopRect,Color.White,m.StopHover,m.Pressed==2);
                Icon(g,"close",StopRect.X+12,StopRect.Y+12,Mix(rest,strong,m.StopHover),Pressing(m.StopPress));
            }
            using(Pen divider=new Pen(Color.FromArgb(41,255,255,255),1))g.DrawLine(divider,391.5f,14,391.5f,34);
            Plate(g,ModeRect,Color.White,m.ModeHover,m.Pressed==3);
            Icon(g,"settings",ModeRect.X+12,ModeRect.Y+12,Mix(rest,strong,m.ModeHover),Pressing(m.ModePress));
        }
        // ---- The access prompt: the bar's surface as a card. The question
        // is its title, the whole request sits under it, and Deny and Allow
        // are real buttons. One window draws the card (shadow, round
        // corners); the dialog inside it holds the text and the buttons.
        internal const int PromptWidth=496,PromptMargin=36,PromptInset=6,PromptPad=10,PromptTitle=22,PromptBodyMost=300;
        internal const int PromptButtonWidth=104,PromptButtonHeight=44,PromptRing=3;
        internal const string PromptNote="No answer in 90 s counts as Deny";
        internal static Color PromptSurface(bool contrast) {return contrast?SystemColors.Window:InkSurface;}
        internal static Color PromptInk(bool contrast) {return contrast?SystemColors.WindowText:Rest;}
        internal static Font PromptFont(float zoom) {return Face(13*zoom,false);}
        internal static void PromptCard(Graphics g,RectangleF panel,bool contrast) {
            Raised(g,panel,18,PromptSurface(contrast));
            using(GraphicsPath shape=Overlay.RoundRect(panel,18))using(Pen edge=new Pen(contrast?SystemColors.WindowText:Color.FromArgb(41,255,255,255),contrast?2:1))g.DrawPath(edge,shape);
        }
        // The dialog's own drawing: the title, the rule over the buttons, and the note beside them.
        internal static void PromptFace(Graphics g,float width,string title,float rule,float noteWidth,bool contrast) {
            g.SmoothingMode=SmoothingMode.AntiAlias;g.PixelOffsetMode=PixelOffsetMode.HighQuality;g.TextRenderingHint=System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
            using(Font head=Face(16,true))using(Font small=Face(12,false)) {
                Text(g,title,head,contrast?SystemColors.WindowText:PaperText,new RectangleF(PromptPad,PromptPad,width-2*PromptPad,PromptTitle));
                using(Pen line=new Pen(contrast?SystemColors.WindowText:Color.FromArgb(26,255,255,255),1))g.DrawLine(line,PromptPad,rule+.5f,width-PromptPad,rule+.5f);
                Text(g,PromptNote,small,contrast?SystemColors.WindowText:Mist,new RectangleF(PromptPad,rule+12,noteWidth,PromptButtonHeight));
            }
        }
        // Allow is filled and Deny is outlined. Hover lifts the plate, a press
        // lands at PressScale, and the focus ring sits outside the shape.
        internal static void PromptButton(Graphics g,RectangleF box,string text,bool filled,bool hover,bool pressed,bool focus,bool contrast) {
            g.SmoothingMode=SmoothingMode.AntiAlias;g.PixelOffsetMode=PixelOffsetMode.HighQuality;g.TextRenderingHint=System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
            Color accent=contrast?SystemColors.Highlight:Violet,ink=contrast?SystemColors.WindowText:PaperText;
            if(focus) {
                RectangleF ring=box;ring.Inflate(PromptRing-.75f,PromptRing-.75f);
                using(GraphicsPath shape=Overlay.RoundRect(ring,12+PromptRing))using(Pen pen=new Pen(accent,1.5f))g.DrawPath(pen,shape);
            }
            var saved=g.Save();
            if(pressed){float cx=box.X+box.Width/2,cy=box.Y+box.Height/2;g.TranslateTransform(cx,cy);g.ScaleTransform(PressScale,PressScale);g.TranslateTransform(-cx,-cy);}
            Color label;
            using(GraphicsPath shape=Overlay.RoundRect(box,12)) {
                if(filled) {
                    Color fill=contrast?accent:pressed?Mix(Violet,InkSurface,.16f):hover?Mix(Violet,Color.White,.28f):Violet;
                    using(SolidBrush brush=new SolidBrush(fill))g.FillPath(brush,shape);
                    label=contrast?SystemColors.HighlightText:InkSurface;
                    if(contrast&&(hover||pressed))using(Pen pen=new Pen(ink,2))g.DrawPath(pen,shape);
                } else {
                    if(!contrast&&(hover||pressed))using(SolidBrush brush=new SolidBrush(Color.FromArgb(pressed?36:22,255,255,255)))g.FillPath(brush,shape);
                    RectangleF inner=box;inner.Inflate(-.5f,-.5f);
                    using(GraphicsPath line=Overlay.RoundRect(inner,11.5f))using(Pen pen=new Pen(contrast?ink:Color.FromArgb(hover||pressed?140:102,255,255,255),contrast&&(hover||pressed)?2:1))g.DrawPath(pen,line);
                    label=ink;
                }
            }
            using(Font face=Face(13,true)) {
                float wide=TextWidth(g,text,face);
                Text(g,text,face,label,new RectangleF(box.X+(box.Width-wide)/2,box.Y,wide+2,box.Height));
            }
            g.Restore(saved);
        }
        // The three questions the runtime asks, as it words them.
        internal static readonly string[] PromptSamples={
            "Allow this application for this session?\r\n\r\nMeeting notes - Notepad\r\nC:\\Windows\\System32\\notepad.exe\r\nPID 18244\r\nAccess: full.\r\n\r\nTask: Type the meeting notes into Notepad and save them.\r\n\r\nIts screenshots and accessibility text go to Antigravity's configured model. Ordinary actions run autonomously. Consequential effects need a separate confirmation. Your real mouse/keyboard will be used. Esc or Ctrl+Alt+F12 stops. Use a disposable account/VM for important data.",
            "Approve ONE sensitive operation?\r\n\r\nSave the notes as meeting.txt in Documents.\r\n\r\nApplication: C:\\Windows\\System32\\notepad.exe\r\nControl: Save\r\n\r\n{\r\n  \"operation\": \"file_dialog\",\r\n  \"args\": {\r\n    \"hwnd\": 7210712,\r\n    \"path\": \"C:\\\\Users\\\\owner\\\\Documents\\\\Projects\\\\Quarterly\\\\A-long-folder-name-that-has-no-spaces-anywhere\\\\meeting.txt\",\r\n    \"entry_method\": \"type\",\r\n    \"reason\": \"Save the notes as meeting.txt in Documents.\"\r\n  }\r\n}\r\n\r\nCheck the actual target. Never let an agent approve this dialog. Deny if the result is unclear.",
            "Launch this application?\r\n\r\nOpen the calculator to check the totals.\r\n\r\n{\r\n  \"app\": \"calc.exe\",\r\n  \"args\": []\r\n}\r\n\r\nThis starts software with your account's privileges. No shell is used. Approve only if intended."
        };
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
            RectangleF panel=new RectangleF(MenuMargin,MenuMargin,MenuWidth,height);
            MenuBody(g,panel);MenuRows(g,items,panel.Location,hover,pressed);MenuEdge(g,panel);
        }
        // The panel's chrome at any height: one neutral drop shadow, the body, and its hairline edge.
        internal static void MenuBody(Graphics g,RectangleF panel) {Raised(g,panel,12,InkRaised);}
        // A surface that floats over the desktop: one neutral drop shadow, then the body.
        static void Raised(Graphics g,RectangleF panel,float radius,Color surface) {
            g.SmoothingMode=SmoothingMode.AntiAlias;g.PixelOffsetMode=PixelOffsetMode.HighQuality;
            // One neutral drop shadow: 0 12 28, black 34%.
            for(int i=14;i>=1;i--) {
                RectangleF soft=panel;soft.Offset(0,12);soft.Inflate(i*2-6,i*2-6);
                using(GraphicsPath shape=Overlay.RoundRect(soft,radius+i*2))using(SolidBrush shade=new SolidBrush(Color.FromArgb(7,0,0,0)))g.FillPath(shade,shape);
            }
            using(GraphicsPath shape=Overlay.RoundRect(panel,radius))using(SolidBrush fill=new SolidBrush(surface))g.FillPath(fill,shape);
        }
        // menu.page: the panel at a height between two pages, the old page's
        // rows leaving and the new page's arriving. Each page is a picture of
        // its rows at device scale; they are placed pixel for pixel.
        internal static void MenuBetween(Graphics g,RectangleF panel,float zoom,Bitmap from,float fromAlpha,Bitmap to,float toAlpha) {
            MenuBody(g,panel);
            var saved=g.Save();g.ResetTransform();g.InterpolationMode=InterpolationMode.NearestNeighbor;
            RectangleF device=new RectangleF(panel.X*zoom,panel.Y*zoom,panel.Width*zoom,panel.Height*zoom);
            using(GraphicsPath inside=Overlay.RoundRect(device,12*zoom)) {
                g.SetClip(inside);
                Point at=new Point((int)Math.Round(device.X),(int)Math.Round(device.Y));
                Fade(g,from,at,fromAlpha);Fade(g,to,at,toAlpha);
            }
            g.Restore(saved);
            MenuEdge(g,panel);
        }
        // menu.page timing, ms into the change: the height moves over Normal
        // (in and out); the old rows leave over FastLeave and the new ones
        // arrive from halfway through that, so no frame is empty.
        internal static void MenuPageAt(double ms,out float move,out float gone,out float come) {
            move=EaseInOut((float)(ms/Normal));gone=1-EaseOut((float)(ms/FastLeave));
            come=EaseOut((float)((ms-FastLeave/2.0)/(Normal-FastLeave/2.0)));
        }
        static void Fade(Graphics g,Bitmap image,Point at,float alpha) {
            if(image==null||alpha<=0)return;
            ColorMatrix matrix=new ColorMatrix();matrix.Matrix33=Math.Min(1,alpha);
            using(ImageAttributes attributes=new ImageAttributes()) {
                attributes.SetColorMatrix(matrix);
                g.DrawImage(image,new Rectangle(at,image.Size),0,0,image.Width,image.Height,GraphicsUnit.Pixel,attributes);
            }
        }
        // One page's rows on the panel's own colour, at device scale.
        internal static Bitmap MenuPage(System.Collections.Generic.List<MenuItem> items,float height,float zoom,int hover,int pressed) {
            Bitmap page=new Bitmap(Math.Max(1,(int)Math.Ceiling(MenuWidth*zoom)),Math.Max(1,(int)Math.Ceiling(height*zoom)),PixelFormat.Format32bppPArgb);
            using(Graphics g=Graphics.FromImage(page)){g.Clear(InkRaised);g.ScaleTransform(zoom,zoom);MenuRows(g,items,PointF.Empty,hover,pressed);}
            return page;
        }
        internal static void MenuEdge(Graphics g,RectangleF panel) {
            g.SmoothingMode=SmoothingMode.AntiAlias;g.PixelOffsetMode=PixelOffsetMode.HighQuality;
            using(GraphicsPath shape=Overlay.RoundRect(panel,12))using(Pen edge=new Pen(Color.FromArgb(41,255,255,255),1))g.DrawPath(edge,shape);
        }
        // One page's rows, with the panel's top-left corner at origin. They
        // are drawn on the panel's own colour, so a page can fade over another.
        internal static void MenuRows(Graphics g,System.Collections.Generic.List<MenuItem> items,PointF origin,int hover,int pressed) {
            g.SmoothingMode=SmoothingMode.AntiAlias;g.PixelOffsetMode=PixelOffsetMode.HighQuality;g.TextRenderingHint=System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
            using(Font body=Face(13,false))using(Font small=Face(12,false))using(Font cap=Face(11,true))
            foreach(MenuItem item in items) {
                RectangleF box=item.Bounds;box.Offset(origin.X,origin.Y);
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
        static GlowField[] Glow(Rectangle app,bool inside,Rectangle clip,float x,float y,double time,float grow=1,float bright=.55f) {
            bool[] sides={inside,inside,inside,inside};
            GlowField veil=new GlowField(GlowField.Veil,app,sides,1,inside?0:8,clip),edge=new GlowField(GlowField.Edge,app,sides,1,inside?0:8,clip);
            veil.Compose(time,x,y,1,bright);edge.Compose(time,x,y,grow,bright);
            return new GlowField[]{veil,edge};
        }
        static void Crop(Bitmap source,Rectangle part,Bitmap sheet,int x,int y) {using(Graphics g=Graphics.FromImage(sheet))g.DrawImage(source,new Rectangle(x,y,part.Width,part.Height),part,GraphicsUnit.Pixel);}
        static int AlphaAt(int[] pixels,int width,int x,int y) {return (pixels[y*width+x]>>24)&255;}
        internal static void Export(string directory) {
            Directory.CreateDirectory(directory);
            int w=1280,h=800;Rectangle screen=new Rectangle(0,0,w,h),window=new Rectangle(190,140,900,520);
            foreach(string host in new string[]{"aurora"}) {
                string tag=host;
                foreach(bool dark in new bool[]{true,false}) {
                    // Maximised: lit inside. At full size: a corner, the edge by the action, the far edge.
                    using(Bitmap image=Backdrop(w,h,dark,screen))using(Bitmap sheet=new Bitmap(1200,400,PixelFormat.Format32bppArgb)) {
                        Lay(image,Glow(screen,true,screen,300,h-60,4.0));
                        image.Save(Path.Combine(directory,"glow-"+tag+"-inside-"+(dark?"dark":"light")+".png"),ImageFormat.Png);
                        Crop(image,new Rectangle(0,h-400,400,400),sheet,0,0);Crop(image,new Rectangle(0,0,400,400),sheet,400,0);Crop(image,new Rectangle(w-400,200,400,400),sheet,800,0);
                        sheet.Save(Path.Combine(directory,"close-"+tag+"-inside-"+(dark?"dark":"light")+".png"),ImageFormat.Png);
                    }
                    // Windowed: lit outside.
                    using(Bitmap image=Backdrop(w,h,dark,window))using(Bitmap sheet=new Bitmap(1200,400,PixelFormat.Format32bppArgb)) {
                        Lay(image,Glow(window,false,screen,window.X+240,window.Bottom-60,4.0));
                        image.Save(Path.Combine(directory,"glow-"+tag+"-outside-"+(dark?"dark":"light")+".png"),ImageFormat.Png);
                        Crop(image,new Rectangle(window.X-110,window.Bottom-290,400,400),sheet,0,0);Crop(image,new Rectangle(window.X-110,window.Y-110,400,400),sheet,400,0);Crop(image,new Rectangle(window.Right-290,window.Y+60,400,400),sheet,800,0);
                        sheet.Save(Path.Combine(directory,"close-"+tag+"-outside-"+(dark?"dark":"light")+".png"),ImageFormat.Png);
                    }
                }
                // Motion: the same stretch of the bottom edge. Top row: the
                // entrance, 50 ms apart (the opacity fade is the window's and
                // is not drawn here). Bottom row: the drift, two seconds apart.
                using(Bitmap sheet=new Bitmap(1200,480,PixelFormat.Format32bppArgb)) {
                    for(int i=0;i<6;i++)using(Bitmap image=Backdrop(w,h,true,screen)) {
                        Lay(image,Glow(screen,true,screen,300,h-60,4.0+i*.05,EaseOut(i*50f/Slow)));Crop(image,new Rectangle(200,h-240,200,240),sheet,i*200,0);
                    }
                    for(int i=0;i<6;i++)using(Bitmap image=Backdrop(w,h,true,screen)) {
                        Lay(image,Glow(screen,true,screen,300,h-60,4.0+i*2));Crop(image,new Rectangle(200,h-240,200,240),sheet,i*200,240);
                    }
                    sheet.Save(Path.Combine(directory,"motion-"+tag+".png"),ImageFormat.Png);
                }
                using(Bitmap image=new Bitmap(288,288,PixelFormat.Format32bppArgb)) {
                    using(Graphics g=Graphics.FromImage(image)){g.Clear(Color.FromArgb(31,33,40));g.SmoothingMode=SmoothingMode.AntiAlias;g.ScaleTransform(3,3);Pointer(g,0);g.TranslateTransform(44,46);Arrow(g);}
                    image.Save(Path.Combine(directory,"pointer-"+tag+".png"),ImageFormat.Png);
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
                        if(hover==1){model.StopHover=1;model.ModeHover=i%2;model.Pressed=i%3==0?2:0;model.StopPress=model.Pressed==2?1:0;}
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
                MenuItem bright=new MenuItem();bright.Id=3;bright.Text="Glow brightness";bright.Note="Soft";items.Add(bright);
                MenuItem rule=new MenuItem();rule.Kind="rule";items.Add(rule);
                MenuItem foot=new MenuItem();foot.Kind="foot";items.Add(foot);
                float tall=MenuLayout(items);
                var docks=new System.Collections.Generic.List<MenuItem>();
                MenuItem dockHead=new MenuItem();dockHead.Kind="head";dockHead.Text="Move bar";docks.Add(dockHead);
                string[] names={"Top left","Top centre","Top right","Bottom left","Bottom centre","Bottom right"};
                for(int i=0;i<names.Length;i++){MenuItem item=new MenuItem();item.Id=10+i;item.Text=names[i];item.Ticks=true;item.Checked=i==1;docks.Add(item);}
                MenuItem dockRule=new MenuItem();dockRule.Kind="rule";docks.Add(dockRule);
                MenuItem reset=new MenuItem();reset.Id=20;reset.Text="Reset";reset.Ticks=true;docks.Add(reset);
                float dockTall=MenuLayout(docks);
                using(Bitmap image=new Bitmap((MenuWidth+2*MenuMargin)*2,(int)((tall+2*MenuMargin)*2),PixelFormat.Format32bppArgb)) {
                    using(Graphics g=Graphics.FromImage(image)){g.Clear(Color.FromArgb(31,33,40));g.ScaleTransform(2,2);Menu(g,items,tall,2,0);}
                    image.Save(Path.Combine(directory,"menu.png"),ImageFormat.Png);
                }
                using(Bitmap image=new Bitmap((MenuWidth+2*MenuMargin)*2,(int)((dockTall+2*MenuMargin)*2),PixelFormat.Format32bppArgb)) {
                    using(Graphics g=Graphics.FromImage(image)){g.Clear(Color.FromArgb(31,33,40));g.ScaleTransform(2,2);Menu(g,docks,dockTall,12,0);}
                    image.Save(Path.Combine(directory,"menu-dock.png"),ImageFormat.Png);
                }
                // menu.page, as the product draws it: five frames 50 ms apart
                // from the main page to the Move bar page, hanging below the bar.
                float zoom=2,most=Math.Max(tall,dockTall);int frameWidth=(MenuWidth+2*MenuMargin)*2,frameHeight=(int)((most+2*MenuMargin)*2);
                using(Bitmap from=MenuPage(items,tall,zoom,2,0))using(Bitmap to=MenuPage(docks,dockTall,zoom,0,0))
                using(Bitmap sheet=new Bitmap(frameWidth*5,frameHeight,PixelFormat.Format32bppArgb)) {
                    using(Graphics g=Graphics.FromImage(sheet)) {
                        g.Clear(Color.FromArgb(31,33,40));
                        for(int i=0;i<5;i++) {
                            float grow,gone,come;MenuPageAt(i*Normal/4.0,out grow,out gone,out come);float height=tall+(dockTall-tall)*grow;
                            using(Bitmap frame=new Bitmap(frameWidth,frameHeight,PixelFormat.Format32bppPArgb)) {
                                using(Graphics f=Graphics.FromImage(frame)){f.Clear(Color.Transparent);f.ScaleTransform(zoom,zoom);MenuBetween(f,new RectangleF(MenuMargin,MenuMargin,MenuWidth,height),zoom,from,gone,to,come);}
                                g.DrawImage(frame,new Rectangle(i*frameWidth,0,frameWidth,frameHeight));
                            }
                        }
                    }
                    sheet.Save(Path.Combine(directory,"menu-page.png"),ImageFormat.Png);
                }
            }
            // The access prompt, laid out by the dialog itself: the three
            // questions at rest, each button hovered and pressed, and a contrast theme.
            {
                var shots=new System.Collections.Generic.List<Bitmap>();
                try {
                    for(int i=0;i<8;i++)using(Guardian.AccessPrompt prompt=new Guardian.AccessPrompt(PromptSamples[i<3?i:i<7?2:1],2,i==7,Rectangle.Empty))shots.Add(prompt.Picture(i==3?1:i==5?2:0,i==4?1:i==6?2:0,i>=3&&i<7?(i<5?1:2):i==7?2:0));
                    int wide=0,tall=0;foreach(Bitmap shot in shots){wide+=shot.Width;tall=Math.Max(tall,shot.Height);}
                    using(Bitmap sheet=new Bitmap(wide,tall,PixelFormat.Format32bppArgb)) {
                        using(Graphics g=Graphics.FromImage(sheet)){g.Clear(Color.FromArgb(31,33,40));int x=0;foreach(Bitmap shot in shots){g.DrawImage(shot,new Rectangle(x,0,shot.Width,shot.Height));x+=shot.Width;}}
                        sheet.Save(Path.Combine(directory,"prompt.png"),ImageFormat.Png);
                    }
                } finally {foreach(Bitmap shot in shots)shot.Dispose();}
            }
            foreach(uint role in new uint[]{32512,32513,32649,32650})
            using(Bitmap image=new Bitmap(96,96,PixelFormat.Format32bppArgb)) {
                using(Graphics g=Graphics.FromImage(image)){g.SmoothingMode=SmoothingMode.AntiAlias;g.ScaleTransform(3,3);NativeCursor(g,role);}
                image.Save(Path.Combine(directory,"cursor-"+role+".png"),ImageFormat.Png);
            }
            using(Bitmap image=new Bitmap(96,96,PixelFormat.Format32bppArgb)) {
                using(Graphics g=Graphics.FromImage(image)){g.SmoothingMode=SmoothingMode.AntiAlias;Pointer(g,0);}
                if(image.GetPixel(54,56).A<110)throw new Exception("The pointer glow is too faint to see");
                if(image.GetPixel(2,2).A!=0)throw new Exception("The pointer glow must end inside its surface");
            }
            // What the glow may never do, checked at its strongest: full
            // brightness, with the last action right at the point tested.
            int[] clear=new int[800*700];
            foreach(GlowField field in Glow(new Rectangle(0,0,800,700),true,new Rectangle(0,0,800,700),400,0,4,1,1))field.Over(clear,800,700);
            if(AlphaAt(clear,800,400,350)!=0)throw new Exception("The glow covers the middle of the app");
            if(AlphaAt(clear,800,400,GlowField.Reach(GlowField.Veil,1)+2)!=0)throw new Exception("The inside glow must end within its reach");
            if(AlphaAt(clear,800,400,1)<120)throw new Exception("The glow is too faint to see at the edge");
            if(AlphaAt(clear,800,400,4)<=AlphaAt(clear,800,400,14)||AlphaAt(clear,800,400,14)<=AlphaAt(clear,800,400,40))throw new Exception("The glow must fade inward");
            if(AlphaAt(clear,800,400,72)>=96)throw new Exception("The glow fogs the app beyond its band");
            clear=new int[800*700];
            foreach(GlowField field in Glow(new Rectangle(100,150,600,400),false,new Rectangle(0,0,800,700),400,150,4,1,1))field.Over(clear,800,700);
            if(AlphaAt(clear,800,400,350)!=0)throw new Exception("The glow covers the middle of the app");
            if(AlphaAt(clear,800,400,156)>=40||AlphaAt(clear,800,106,350)>=40)throw new Exception("The outside glow tints the app");
            if(AlphaAt(clear,800,400,148)<120)throw new Exception("The glow is too faint to see at the edge");
            if(AlphaAt(clear,800,400,146)<=AlphaAt(clear,800,400,130))throw new Exception("The outside glow must fade away from the window");
            if(AlphaAt(clear,800,400,150-GlowField.Reach(GlowField.Veil,0)-2)!=0)throw new Exception("The outside glow must end within its reach");
            {
                bool[] none={false,false,false,false};Rectangle app=new Rectangle(400,200,1100,700),all=new Rectangle(0,0,1920,1080);
                GlowField band=new GlowField(GlowField.Edge,app,none,1.25f,10,all),wash=new GlowField(GlowField.Veil,app,none,1.25f,10,all);
                int pixels=0;foreach(Rectangle strip in band.Strips)pixels+=strip.Width*strip.Height;
                var watch=System.Diagnostics.Stopwatch.StartNew();for(int i=0;i<60;i++)band.Compose(4+i*.033,600,880,1,.55f);double each=watch.Elapsed.TotalMilliseconds/60;
                watch.Restart();for(int i=0;i<20;i++)wash.Compose(4+i,600,880,1,.55f);
                Console.WriteLine("TIMING band "+each.ToString("0.00")+" ms over "+pixels+" px; wash "+(watch.Elapsed.TotalMilliseconds/20).ToString("0.00")+" ms");
            }
            Console.WriteLine("Visual renders and glow checks passed.");
        }
    }
}
