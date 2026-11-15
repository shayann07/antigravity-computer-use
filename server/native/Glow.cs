// The light around the window the agent is working in. Original artwork: no
// vendor assets. This file is the pixel maths only; the windows that show it
// live in Overlay.cs.
//
// It is light, not an outline. A glow reads as light when it has a bright
// source and falls away fast, so there are four parts, strongest first:
//   ribbon  a luminous band on the window's edge, hot at its centre
//   swell   the same band grown thicker; how thick varies along the edge and
//           over time, so the light looks alive rather than ruled
//   bloom   coloured light spilling a short way from the band
//   wash    a faint, deep veil well into the window, so the light has depth
//           without fogging what the app shows
// The colours travel slowly around the window, and every part is brighter the
// nearer it is to the agent's last action, so the glow also says where in the
// app it is working.
using System;
using System.Drawing;

namespace Axon {
    // The colours of the light: one palette for every app, so the product
    // has one look. Warm and cool tones follow one another round the window
    // and blend where they meet.
    internal static class GlowTones {
        static readonly int[][] Aurora={new int[]{84,150,255},new int[]{150,112,255},new int[]{255,108,178},new int[]{255,152,88},new int[]{255,206,112},new int[]{98,208,255}};
        const int Steps=1024;
        static volatile int[] ramp=Build(ControlContract.Tones("default")??Aurora);
        internal static int Version {get {return 0;}}
        // The stops follow one another in a loop. Every blend is lifted to
        // full brightness, so the light never passes through a dull mix.
        static int[] Build(int[][] stops) {
            int[] colours=new int[Steps];
            for(int i=0;i<Steps;i++) {
                double at=i/(double)Steps*stops.Length;int a=(int)at%stops.Length,b=(a+1)%stops.Length;
                double t=at-Math.Floor(at);t=t*t*(3-2*t);
                double r=stops[a][0]+(stops[b][0]-stops[a][0])*t,g=stops[a][1]+(stops[b][1]-stops[a][1])*t,bl=stops[a][2]+(stops[b][2]-stops[a][2])*t;
                double top=Math.Max(r,Math.Max(g,bl)),lift=top>0?255/top:1;
                colours[i]=((int)Math.Min(255,r*lift)<<16)|((int)Math.Min(255,g*lift)<<8)|(int)Math.Min(255,bl*lift);
            }
            return colours;
        }
        // phase is in laps; any real number.
        internal static int At(double phase) {
            int[] colours=ramp;phase-=Math.Floor(phase);
            return colours[(int)(phase*Steps)&(Steps-1)];
        }
        internal static Color ColorAt(double phase,int alpha=255) {int c=At(phase);return Color.FromArgb(alpha,(c>>16)&255,(c>>8)&255,c&255);}
    }

    // One set of four strips (top, right, bottom, left) around a window. The
    // falloff is baked once per geometry; a frame only multiplies it by one
    // gain and colour per point of the edge. Each edge is lit outside the
    // window when there is room and inside it when there is not (a maximised
    // or full-screen app).
    //
    // There are two kinds, so the costly part stays small: Edge is the ribbon,
    // swell and bloom in a narrow band and is repainted every frame; Veil is
    // the deep wash, changes slowly and is repainted a few times a second.
    internal sealed class GlowField {
        internal const int Edge=0,Veil=1;
        const int Lip=3;   // DIPs an Edge strip overlaps the frame, for rounded corners
        // DIPs the light reaches: away from an edge that is lit outside,
        // into the window from an edge that is lit inside, and into the
        // window from an edge that is lit outside.
        internal static int Reach(int kind,int zone) {return kind==Edge?(zone==2?Lip:84):(zone==0?120:zone==1?160:80);}
        static readonly double MinBright=ControlContract.UiNumber("glow_min",.5,0,1),Spread=ControlContract.UiNumber("glow_reach",.42,.05,4);
        static readonly double Strength=ControlContract.UiNumber("glow_strength",.6,0,1),Lift=ControlContract.UiNumber("glow_lift",.3,0,2);
        // One lap of colour around the window, in seconds.
        static readonly double Lap=ControlContract.UiNumber("glow_lap_seconds",18,2,120);
        const double RibbonWeight=.62,SwellWeight=.9,BloomWeight=.55,WashWeight=.24;
        internal readonly int Kind;
        internal readonly Rectangle Frame,Clip;internal readonly bool[] Inside;internal readonly float Scale;internal readonly int Radius;
        internal readonly Rectangle[] Strips=new Rectangle[4];
        // Premultiplied ARGB, one int per pixel.
        internal readonly int[][] Pixels=new int[4][];
        readonly byte[][] first=new byte[4][],second=new byte[4][],third=new byte[4][];   // Edge: ribbon, swell, bloom. Veil: wash.
        readonly int[][] index=new int[4][];
        readonly int perimeter;readonly float[] rest;
        readonly int[] gainA,gainB,gainC,tone,hot;
        float actionX,actionY;int actionIndex;
        internal float ActionX {get {return actionX;}} internal float ActionY {get {return actionY;}}

        static readonly float[] Wave=MakeWave();
        static float[] MakeWave() {float[] w=new float[1024];for(int i=0;i<1024;i++)w[i]=(float)Math.Sin(i/1024.0*2*Math.PI);return w;}
        static float Sine(double turns) {turns-=Math.Floor(turns);return Wave[(int)(turns*1024)&1023];}

        internal GlowField(int kind,Rectangle frame,bool[] inside,float scale,int radius,Rectangle clip) {
            Kind=kind;Frame=frame;Inside=(bool[])inside.Clone();Scale=scale<=0?1:scale;Clip=clip;
            bool allOut=!inside[0]&&!inside[1]&&!inside[2]&&!inside[3];
            Radius=allOut?Math.Max(0,Math.Min(radius,Math.Min(frame.Width,frame.Height)/2)):0;
            int l=frame.Left,t=frame.Top,r=frame.Right,b=frame.Bottom,half=Math.Min(frame.Width,frame.Height)/2;
            // How far each edge's strip reaches away from the window and into it.
            int[] outward=new int[4],inward=new int[4];
            for(int e=0;e<4;e++) {
                outward[e]=inside[e]?0:(int)Math.Ceiling(Reach(kind,0)*Scale);
                inward[e]=Math.Min(half,(int)Math.Ceiling(Reach(kind,inside[e]?1:2)*Scale));
            }
            // Top and bottom own the corners; left and right fill between them.
            Strips[0]=Rectangle.FromLTRB(l-outward[3],t-outward[0],r+outward[1],t+inward[0]);
            Strips[2]=Rectangle.FromLTRB(l-outward[3],b-inward[2],r+outward[1],b+outward[2]);
            Strips[3]=Rectangle.FromLTRB(l-outward[3],t+inward[0],l+inward[3],b-inward[2]);
            Strips[1]=Rectangle.FromLTRB(r-inward[1],t+inward[0],r+outward[1],b-inward[2]);
            for(int k=0;k<4;k++) {Strips[k]=Rectangle.Intersect(Strips[k],clip);if(Strips[k].Width<=0||Strips[k].Height<=0)Strips[k]=Rectangle.Empty;}
            perimeter=Math.Max(1,2*(frame.Width+frame.Height));
            rest=new float[perimeter];gainA=new int[perimeter];gainB=new int[perimeter];gainC=new int[perimeter];tone=new int[perimeter];hot=new int[perimeter];
            Bake();SetAction(frame.Left+frame.Width/2f,frame.Top+frame.Height/2f);
        }
        static double Fade(double u,double reach) {double x=Math.Max(0,Math.Min(1,(reach-u)/(reach*.4)));return x*x*(3-2*x);}
        // How strong each part is, u DIPs from the edge.
        static void Profile(int kind,int zone,double u,out double a,out double b,out double c) {
            a=b=c=0;double reach=Reach(kind,zone);
            if(u>reach)return;
            if(kind==Edge) {
                if(zone==2)return;
                a=Math.Exp(-Math.Pow(u/7,1.6));b=Math.Exp(-Math.Pow(u/22,1.7));c=Math.Exp(-u/22)*Fade(u,reach);
            }
            else a=(zone==0?Math.Exp(-u/30):zone==1?Math.Exp(-u/54):.5*Math.Exp(-u/24))*Fade(u,reach);
        }
        // Position along the edge, clockwise from the top-left corner.
        int EdgeIndex(int edge,int x,int y) {
            int w=Frame.Width,h=Frame.Height;
            x=Math.Max(Frame.Left,Math.Min(Frame.Right-1,x));y=Math.Max(Frame.Top,Math.Min(Frame.Bottom-1,y));
            return edge==0?x-Frame.Left:edge==1?w+(y-Frame.Top):edge==2?w+h+(Frame.Right-1-x):2*w+h+(Frame.Bottom-1-y);
        }
        // Inside the window the position leans toward the nearer corner as
        // the pixel gets deeper, so the two edges that meet at a corner agree
        // along its diagonal and the colours turn the corner without a seam.
        int InnerIndex(int edge,double px,double py) {
            int w=Frame.Width,h=Frame.Height;double along,length,depth;int start;
            if(edge==0){along=px-Frame.Left;length=w;depth=py-Frame.Top;start=0;}
            else if(edge==1){along=py-Frame.Top;length=h;depth=Frame.Right-px;start=w;}
            else if(edge==2){along=Frame.Right-px;length=w;depth=Frame.Bottom-py;start=w+h;}
            else {along=Frame.Bottom-py;length=h;depth=px-Frame.Left;start=2*w+h;}
            int i=start+(int)Math.Round(along+depth*(2*along/length-1));
            return ((i%perimeter)+perimeter)%perimeter;
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
            // The profiles, tabulated by distance in quarter pixels.
            byte[][][] table=new byte[3][][];
            for(int zone=0;zone<3;zone++) {
                int length=(int)Math.Ceiling(Reach(Kind,zone)*s*4)+2;table[zone]=new byte[3][];
                for(int part=0;part<3;part++)table[zone][part]=new byte[length];
                for(int q=0;q<length;q++) {
                    double pa,pb,pc;Profile(Kind,zone,q/4.0/s,out pa,out pb,out pc);
                    table[zone][0][q]=(byte)Math.Round(255*pa);table[zone][1][q]=(byte)Math.Round(255*pb);table[zone][2][q]=(byte)Math.Round(255*pc);
                }
            }
            for(int k=0;k<4;k++) {
                Rectangle strip=Strips[k];int count=strip.Width*strip.Height;
                Pixels[k]=new int[count];first[k]=new byte[count];second[k]=new byte[count];third[k]=new byte[count];index[k]=new int[count];
                for(int yy=0;yy<strip.Height;yy++)for(int xx=0;xx<strip.Width;xx++) {
                    int at=yy*strip.Width+xx,x=strip.Left+xx,y=strip.Top+yy;index[k][at]=-1;
                    double px=x+.5,py=y+.5,away=-1;int edge=-1;
                    double dx=Math.Max(Math.Max(l-px,px-r),0),dy=Math.Max(Math.Max(t-py,py-b),0);
                    if(Radius>0) {
                        // Signed distance to the rounded frame.
                        double qx=Math.Abs(px-cx)-(hw-Radius),qy=Math.Abs(py-cy)-(hh-Radius);
                        double signed=Math.Sqrt(Math.Max(qx,0)*Math.Max(qx,0)+Math.Max(qy,0)*Math.Max(qy,0))+Math.Min(Math.Max(qx,qy),0)-Radius;
                        if(signed>=0) {away=signed;edge=py<t?0:py>=b?2:px<l?3:px>=r?1:(Math.Min(py-t,b-py)<Math.Min(px-l,r-px)?(py-t<b-py?0:2):(px-l<r-px?3:1));}
                    } else if(dx>0||dy>0) {
                        int horizontal=px<l?3:1,vertical=py<t?0:2;
                        if(dx>0&&dy>0) {if(Inside[horizontal]||Inside[vertical])continue;away=Math.Sqrt(dx*dx+dy*dy);edge=dy>=dx?vertical:horizontal;}
                        else if(dx>0) {if(Inside[horizontal])continue;away=dx;edge=horizontal;}
                        else {if(Inside[vertical])continue;away=dy;edge=vertical;}
                    }
                    int va=0,vb=0,vc=0;
                    if(edge>=0) {
                        int q=(int)(away*4);byte[][] parts=table[0];
                        if(q>=parts[0].Length)continue;
                        va=parts[0][q];vb=parts[1][q];vc=parts[2][q];
                    } else {
                        // Inside the window. Where two edges meet, their light adds
                        // smoothly, so a corner has no mitred seam.
                        double[] depth={py-t,r-px,b-py,px-l};double nearest=Double.MaxValue;
                        for(int e=0;e<4;e++) {
                            byte[][] parts=table[Inside[e]?1:2];int q=(int)(depth[e]*4);
                            if(q<0||q>=parts[0].Length)continue;
                            va=255-(255-va)*(255-parts[0][q])/255;vb=255-(255-vb)*(255-parts[1][q])/255;vc=255-(255-vc)*(255-parts[2][q])/255;
                            if(depth[e]<nearest){nearest=depth[e];edge=e;}
                        }
                        if(edge<0)continue;
                    }
                    if(va==0&&vb==0&&vc==0)continue;
                    // Dither the long falloffs, so they do not band on 8-bit displays.
                    uint hash=(uint)(x*73856093)^(uint)(y*19349663);hash^=hash>>13;hash*=0x5bd1e995;hash^=hash>>15;
                    int nudge=(int)(hash&3)-1;
                    if(Kind==Veil){if(va>2)va=Math.Max(0,Math.Min(255,va+nudge));}
                    else if(vc>2)vc=Math.Max(0,Math.Min(255,vc+nudge));
                    first[k][at]=(byte)va;second[k][at]=(byte)vb;third[k][at]=(byte)vc;
                    index[k][at]=away>=0?EdgeIndex(edge,x,y):InnerIndex(edge,px,py);
                }
            }
        }
        // Where the agent last acted, in screen pixels. The edge is brightest
        // nearest this point and cools away from it.
        internal void SetAction(float x,float y) {
            actionX=x;actionY=y;
            double reach=Spread*Math.Sqrt((double)Frame.Width*Frame.Width+(double)Frame.Height*Frame.Height);
            double best=Double.MaxValue;
            for(int i=0;i<perimeter;i++) {
                float ex,ey;EdgePoint(i,out ex,out ey);
                double d=Math.Sqrt((ex-x)*(ex-x)+(ey-y)*(ey-y));
                if(d<best){best=d;actionIndex=i;}
                rest[i]=(float)(MinBright+(1-MinBright)*Math.Exp(-(d/reach)*(d/reach)));
            }
        }
        // time (seconds) carries the colours around the edge and lets the
        // band thicken and thin, so the light is never still. lift 0..1
        // raises it when input lands; reveal 0..1 draws it on from the action
        // point; each pulse 0..1 is one swell travelling away from that
        // point, both ways.
        internal void Compose(double time,float lift,float reveal,float[] pulses) {
            double travel=.48*perimeter/2.0,width=110*Scale,raise=1+Lift*Math.Max(0,Math.Min(1,lift)),turn=time/Lap;
            for(int i=0;i<perimeter;i++) {
                double d=Math.Abs(i-actionIndex);d=Math.Min(d,perimeter-d);
                double place=i/(double)perimeter,near=rest[i],shown=1,surge=0;
                if(pulses!=null)foreach(float q in pulses) {
                    if(q<0||q>=1)continue;
                    double k=(d-travel*DesktopVisuals.EaseOut(q))/width;surge+=Math.Exp(-k*k)*(1-DesktopVisuals.EaseIn(q));
                }
                if(reveal<1) {
                    double front=reveal*perimeter/2.0,k=(d-front)/(60*Scale);
                    shown=Math.Max(0,Math.Min(1,(front-d)/(40*Scale)+1));surge+=.7*Math.Exp(-k*k)*shown;
                }
                // The colours travel one way; the thickness wanders the other.
                int colour=GlowTones.At(place*2-turn+.09*Sine(place*3+turn*.6)+.04*Sine(place*7-turn*1.3));
                double thick=Math.Max(0,Math.Min(1,.5+.3*Sine(place*5+time/6.1)+.24*Sine(place*8-time/4.3+.37)+.16*Sine(place*13+time/3.1+.71)));
                double breath=Math.Max(0,Math.Min(1,.55+.28*Sine(place*2-time/9.1)+.17*Sine(place*4+time/6.3+.21)));
                int cr=(colour>>16)&255,cg=(colour>>8)&255,cb=colour&255;
                tone[i]=((cr+(255-cr)*10/100)<<16)|((cg+(255-cg)*10/100)<<8)|(cb+(255-cb)*10/100);
                // The band's centre is the same colour, a little lighter. Never white.
                hot[i]=((cr+(255-cr)*30/100)<<16)|((cg+(255-cg)*30/100)<<8)|(cb+(255-cb)*30/100);
                if(Kind==Edge) {
                    gainA[i]=(int)(256*Strength*RibbonWeight*(.84+.16*near)*shown);
                    gainB[i]=(int)(256*Strength*SwellWeight*Math.Min(1,(.22+.78*thick)*(.7+.3*near)+.8*surge)*raise*shown);
                    gainC[i]=(int)(256*Strength*BloomWeight*Math.Min(1.25,(.6+.4*breath)*(.6+.4*near)+.6*surge)*raise*shown);
                } else gainA[i]=(int)(256*Strength*WashWeight*(.55+.45*near)*(.8+.2*breath)*raise*shown);
            }
            for(int k=0;k<4;k++) {
                int[] output=Pixels[k],ix=index[k];byte[] pa=first[k],pb=second[k],pc=third[k];
                if(Kind==Edge) {
                    for(int at=0;at<ix.Length;at++) {
                        int i=ix[at];if(i<0)continue;
                        int ribbon=(pa[at]*gainA[i])>>8,body=(pb[at]*gainB[i]+pc[at]*gainC[i])>>8;
                        int alpha=ribbon+body;if(alpha>255)alpha=255;
                        int h=hot[i],c=tone[i];
                        int red=(ribbon*((h>>16)&255)+body*((c>>16)&255))>>8,green=(ribbon*((h>>8)&255)+body*((c>>8)&255))>>8,blue=(ribbon*(h&255)+body*(c&255))>>8;
                        if(red>alpha)red=alpha;if(green>alpha)green=alpha;if(blue>alpha)blue=alpha;
                        output[at]=(alpha<<24)|(red<<16)|(green<<8)|blue;
                    }
                } else {
                    for(int at=0;at<ix.Length;at++) {
                        int i=ix[at];if(i<0)continue;
                        int alpha=(pa[at]*gainA[i])>>8;if(alpha>255)alpha=255;
                        int c=tone[i];
                        output[at]=(alpha<<24)|(((alpha*((c>>16)&255))>>8)<<16)|(((alpha*((c>>8)&255))>>8)<<8)|((alpha*(c&255))>>8);
                    }
                }
            }
        }
        // Lays the composed strips over a picture held as ARGB ints, the way
        // the desktop would: premultiplied "over". The surface's origin is
        // screen (0,0). Used for previews and their checks.
        internal void Over(int[] surface,int width,int height) {
            for(int k=0;k<4;k++) {
                Rectangle strip=Strips[k];if(strip.IsEmpty)continue;int[] source=Pixels[k];
                for(int y=Math.Max(0,strip.Top);y<Math.Min(height,strip.Bottom);y++)for(int x=Math.Max(0,strip.Left);x<Math.Min(width,strip.Right);x++) {
                    int p=source[(y-strip.Top)*strip.Width+(x-strip.Left)],a=(p>>24)&255;if(a==0)continue;
                    int q=surface[y*width+x],keep=255-a;
                    int alpha=Math.Min(255,a+(((q>>24)&255)*keep)/255),red=Math.Min(255,((p>>16)&255)+(((q>>16)&255)*keep)/255),green=Math.Min(255,((p>>8)&255)+(((q>>8)&255)*keep)/255),blue=Math.Min(255,(p&255)+((q&255)*keep)/255);
                    surface[y*width+x]=(alpha<<24)|(red<<16)|(green<<8)|blue;
                }
            }
        }
    }
}
