// The control bar's body while it is dragged and thrown.
//
// The motion is adapted from the liquidglass Calm tab-bar selector
// (GlassPoseDynamics.kt and ports/dotnet/LiquidGlass.Skia/CalmSelector.cs),
// Copyright the liquidglass authors, licensed under the Apache License,
// Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0). Changed for a
// desktop bar: two axes instead of one, docks instead of tabs, and the
// screen's work area as the wall. Departures from the library's numbers are
// named below and in docs/visual-design.md.
using System;

namespace Axon {
    // One closed-form damped spring, mass 1: stiffness w^2, damping 2*zeta*w.
    // The target is held still over a step, so it is exact at any frame rate.
    internal struct BodySpring {
        internal double Value, Velocity;
        internal void Step(double target,double w,double zeta,double dt) {
            if(dt<=0||w<=0)return;
            double d=Value-target,v=Velocity;
            if(d==0&&v==0)return;
            zeta=Math.Max(0,Math.Min(1,zeta));
            if(zeta>=.9999) {
                double e=Math.Exp(-w*dt);
                Value=target+e*((1+w*dt)*d+dt*v);
                Velocity=e*((1-w*dt)*v-w*w*dt*d);
            } else {
                double a=zeta*w,b=w*Math.Sqrt(1-zeta*zeta),e=Math.Exp(-a*dt),c=Math.Cos(b*dt),s=Math.Sin(b*dt);
                Value=target+e*(d*c+(v+a*d)*s/b);
                Velocity=e*(v*c-(a*v+w*w*d)*s/b);
            }
        }
    }

    internal sealed class BarBody {
        // bar.throw and bar.squash tokens.
        // From the library (Calm): the critical centre spring; the stretch's
        // drive and shape springs, held reference speed and gain; the
        // two-edge landing at a wall.
        internal const double CentreOmega=24,DriveOmega=10,ShapeOmega=32,ShapeZeta=.72,HeldReference=8,TravelStrain=.6;
        internal const double TrailingInOmega=9,TrailingInZeta=.3,TrailingStiffening=.5,RecoveryOmega=13,Carry=.1,ImpactReach=.3,ImpactSpeed=.6;
        internal const double FingerTau=.035,StopWindow=.040,StopTau=.060,Step=1/240.0,FineStep=1/960.0,LongestCatchUp=.5;
        // Departures for a 440 x 48 bar on a whole screen. A "slot" is
        // BodySlot DIP. The stretch is capped at MaxStrain (the library allows
        // .336) and each axis is driven by its own speed, with no shear. An
        // edge never shortens below MinAlong of its length. A release at
        // FlingSpeed DIP/s or more glides on with its own speed, decaying over
        // Glide seconds (the library's spring is made for a hop of a tab or
        // two); only reaching a screen edge still faster than ImpactSpeed of
        // its width a second starts the two-edge landing. Where it stops, it
        // snaps to a dock within the snap distance.
        internal const double BodySlot=96,MaxStrain=.2,MinAlong=.6,FlingSpeed=900,Glide=.4,Remaining=3,LeanMost=24,ReleaseReference=10;
        // Bench switch: keep a gliding bar stretched by its own speed (the
        // library relaxes it at release; its hop is short, our glide is not).
        internal static bool GlideStretch;

        enum Mode {Held,Glide,Land,Settle}
        sealed class Axis {
            internal Mode Mode;internal BodySpring C;internal double Start,V0,T,Target,Low,High,Give,Rest;
            internal BodySpring Lead,Trail;internal int Dir;internal double RestLead,RestTrail,Wall;internal bool Carried;
            internal double Centre {get {return Mode==Mode.Land?(Lead.Value+Trail.Value)/2:C.Value;}}
            internal double Velocity {get {return Mode==Mode.Land?(Lead.Velocity+Trail.Velocity)/2:C.Velocity;}}
            internal double Along {get {return Mode==Mode.Land?Math.Max(MinAlong,Math.Abs(Lead.Value-Trail.Value)/Rest):1;}}
        }
        readonly double restW,restH,slot;
        readonly Axis x=new Axis(),y=new Axis();
        BodySpring drive,strainU,strainV;double dirU=1,dirV;readonly double scale;
        double fingerVX,fingerVY,sinceSample,lastFingerX,lastFingerY,heldDirX,heldDirY,reversal=1,snap;
        double[] docksX=new double[0],docksY=new double[0];
        bool snapped;
        internal bool Done=true;
        // Whether each axis took a wall impact since the last release, and
        // the fastest the centre has moved since then (px/s).
        internal bool ImpactX,ImpactY;internal double PeakSpeed;

        // restW, restH and scale in device pixels for the bar's monitor.
        internal BarBody(double restW,double restH,double scale) {this.restW=restW;this.restH=restH;slot=BodySlot*scale;this.scale=scale;x.Rest=restW;y.Rest=restH;}
        internal bool Held {get {return x.Mode==Mode.Held&&!Done;}}
        internal double CentreX {get {return x.Centre;}}
        internal double CentreY {get {return y.Centre;}}
        internal double VelocityX {get {return x.Velocity;}}
        internal double VelocityY {get {return y.Velocity;}}
        internal double AlongX {get {return x.Along;}}
        internal double AlongY {get {return y.Along;}}
        // How stretched it is (ρ, the strain's magnitude).
        internal double Strain {get {return Math.Sqrt(strainU.Value*strainU.Value+strainV.Value*strainV.Value);}}
        internal double FingerVX {get {return fingerVX;}}
        internal double FingerVY {get {return fingerVY;}}

        // Caught, mid-flight or at rest: the body is held where it is.
        internal void Grab(double px,double py) {
            double vx=x.Velocity,vy=y.Velocity;
            if(Done)vx=vy=0;
            x.Mode=y.Mode=Mode.Held;Done=false;
            x.C.Value=px;y.C.Value=py;x.C.Velocity=fingerVX=vx;y.C.Velocity=fingerVY=vy;
            lastFingerX=px;lastFingerY=py;sinceSample=0;
        }
        // The person holds the bar: its centre follows the pointer exactly,
        // and the pointer's filtered speed drives the stretch.
        internal void Hold(double px,double py,double dt) {Hold(px,py,px,py,dt);}
        // As Hold, with the speed measured from where the pointer itself is
        // (handX, handY), not the bar the edge holds back: a flick into the
        // edge is a throw even though the bar barely moved.
        internal void Hold(double px,double py,double handX,double handY,double dt) {
            if(!Held){Grab(px,py);lastFingerX=handX;lastFingerY=handY;return;}
            if(dt>0) {
                double k=1-Math.Exp(-dt/FingerTau);
                fingerVX+=((handX-lastFingerX)/dt-fingerVX)*k;fingerVY+=((handY-lastFingerY)/dt-fingerVY)*k;
                sinceSample=0;
            }
            lastFingerX=handX;lastFingerY=handY;
            x.C.Value=px;y.C.Value=py;x.C.Velocity=fingerVX;y.C.Velocity=fingerVY;
        }
        // Let go. The centre may rest between low and high on each axis
        // (the screen's edges less the dock insets, as centre positions);
        // give is how far past that line the leading edge may press. Docks
        // are resting centres it snaps to when it stops within snap px.
        // At FlingSpeed or faster (the caller decides) it glides on;
        // otherwise it is put down where it is.
        // The screen it lives on, as for Release: the stretch never draws the
        // bar past the screen's edge (the rest line plus the give).
        internal void Limits(double lowX,double highX,double giveX,double lowY,double highY,double giveY) {
            x.Low=lowX;x.High=highX;x.Give=giveX;y.Low=lowY;y.High=highY;y.Give=giveY;haveLimits=true;
        }
        bool haveLimits;
        internal void Release(bool thrown,double lowX,double highX,double giveX,double lowY,double highY,double giveY,double[] docksX,double[] docksY,double snap) {
            Limits(lowX,highX,giveX,lowY,highY,giveY);
            Done=false;ImpactX=ImpactY=false;PeakSpeed=0;snapped=false;
            this.docksX=docksX??new double[0];this.docksY=docksY??new double[0];this.snap=snap;
            Let(x,thrown?fingerVX:0,lowX,highX,giveX);Let(y,thrown?fingerVY:0,lowY,highY,giveY);
        }
        void Let(Axis a,double v,double low,double high,double give) {
            a.Low=low;a.High=high;a.Give=give;a.Carried=false;
            double p=Math.Max(low,Math.Min(high,a.C.Value));
            // Let go already past the rest line and flung at that edge: it
            // presses into the edge from where it is.
            if(p!=a.C.Value) {
                int dir=a.C.Value>high?1:-1;
                if(v*dir>ImpactSpeed*restW){StartLanding(a,p,dir,v);a.Lead.Value=a.C.Value+dir*a.Rest/2;a.Trail.Value=a.C.Value-dir*a.Rest/2;return;}
            }
            if(v==0||p!=a.C.Value){a.Mode=Mode.Settle;a.C.Velocity=0;a.Target=p;return;}
            a.Mode=Mode.Glide;a.Start=a.C.Value;a.V0=v;a.T=0;
        }
        // Puts the body at rest at once (reduced motion, hiding, a new place).
        internal void Snap(double px,double py) {
            x.Mode=y.Mode=Mode.Settle;Done=true;
            x.C.Value=x.Target=px;y.C.Value=y.Target=py;x.C.Velocity=y.C.Velocity=fingerVX=fingerVY=0;
            drive=strainU=strainV=new BodySpring();
        }

        internal void Advance(double seconds) {
            if(Done)return;
            seconds=Math.Min(seconds,LongestCatchUp);
            while(seconds>1e-9) {
                double dt=Math.Min(seconds,x.Mode==Mode.Land||y.Mode==Mode.Land?FineStep:Step);
                Substep(dt);seconds-=dt;
            }
            if(!Held) {
                double speed=Math.Sqrt(x.Velocity*x.Velocity+y.Velocity*y.Velocity);if(speed>PeakSpeed)PeakSpeed=speed;
                // Once both axes have stopped moving on their own, a dock
                // within reach takes it, once.
                if(!snapped&&x.Mode==Mode.Settle&&y.Mode==Mode.Settle){snapped=true;SnapToDock();}
                if(snapped&&Quiet())Snap(x.Target,y.Target);
            }
        }
        void SnapToDock() {
            for(int i=0;i<docksX.Length&&i<docksY.Length;i++)
                if(Math.Abs(docksX[i]-x.Target)<=snap&&Math.Abs(docksY[i]-y.Target)<=snap){x.Target=docksX[i];y.Target=docksY[i];return;}
        }
        void Substep(double dt) {
            if(Held) {
                sinceSample+=dt;
                if(sinceSample>StopWindow){double k=Math.Exp(-dt/StopTau);fingerVX*=k;fingerVY*=k;x.C.Velocity=fingerVX;y.C.Velocity=fingerVY;}
            } else {StepAxis(x,dt);StepAxis(y,dt);}
            // The stretch (bar.stretch): the library's area-preserving strain,
            // in any direction. One drive from the total speed; two springing
            // components, u = s(vx²-vy²)/|v|² and v = s·2vxvy/|v|², so the axis
            // of the stretch turns smoothly with the travel and never flips.
            double vx=Held?fingerVX:x.Velocity,vy=Held?fingerVY:y.Velocity,vv=vx*vx+vy*vy,speed2=vv/(slot*slot),speed=Math.Sqrt(speed2);
            // A scrub back and forth does not build the stretch: a reversal
            // within .28 s keeps .4 of it (.85 otherwise), and it rebuilds
            // over the next .25 s.
            double suppression=1;
            if(Held) {
                reversal+=dt;
                if(speed>.1) {
                    double ux=vx/(speed*slot),uy=vy/(speed*slot);
                    if((heldDirX!=0||heldDirY!=0)&&ux*heldDirX+uy*heldDirY<0){drive.Value*=reversal<.28?.4:.85;drive.Velocity=0;reversal=0;}
                    heldDirX=ux;heldDirY=uy;
                }
                suppression=Math.Max(.15,Math.Min(1,reversal/.25));
            } else {heldDirX=heldDirY=0;reversal=1;}
            if(speed>.5){dirU=(vx*vx-vy*vy)/vv;dirV=2*vx*vy/vv;}
            // Held, it is driven by the pointer's speed. Let go, it relaxes,
            // as in the library, unless GlideStretch keeps a gliding bar
            // stretched by its own speed (reference ReleaseReference).
            bool gliding=x.Mode==Mode.Glide||y.Mode==Mode.Glide,landing=x.Mode==Mode.Land||y.Mode==Mode.Land;
            double reference=Held?HeldReference:ReleaseReference,r2=reference*reference;
            drive.Step(Held||GlideStretch&&gliding&&!landing?suppression*speed2/(r2+speed2):0,DriveOmega,1,dt);
            double s=Math.Max(0,Math.Min(MaxStrain,TravelStrain*drive.Value));
            // A wall flattens the lean.
            strainU.Step(s*dirU,ShapeOmega,ShapeZeta,dt);
            strainV.Step(landing?0:s*dirV,ShapeOmega,ShapeZeta,dt);
        }
        void StepAxis(Axis a,double dt) {
            if(a.Mode==Mode.Glide) {
                // bar.throw: it keeps its own speed, decaying over Glide.
                a.T+=dt;double e=Math.Exp(-a.T/Glide),p=a.Start+a.V0*Glide*(1-e),v=a.V0*e;
                int dir=p>a.High?1:p<a.Low?-1:0;
                if(dir!=0) {
                    double line=dir>0?a.High:a.Low;
                    // bar.squash: reaching the edge still fast, it lands on two edges.
                    if(v*dir>ImpactSpeed*restW){StartLanding(a,line,dir,v);return;}
                    a.Mode=Mode.Settle;a.C.Value=line;a.C.Velocity=0;a.Target=line;return;
                }
                a.C.Value=p;a.C.Velocity=v;
                // The last few pixels of the glide go to the settling spring.
                if(Math.Abs(v)*Glide<Remaining){a.Mode=Mode.Settle;a.Target=a.Start+a.V0*Glide;}
                return;
            }
            if(a.Mode==Mode.Land) {
                StepLanding(a,dt);
                if(Math.Abs(a.Lead.Value-a.RestLead)<.25&&Math.Abs(a.Trail.Value-a.RestTrail)<.25&&Math.Abs(a.Lead.Velocity)<1.5&&Math.Abs(a.Trail.Velocity)<1.5) {
                    a.Mode=Mode.Settle;a.C.Value=a.Target=a.RestLead-a.Dir*a.Rest/2;a.C.Velocity=0;
                }
                return;
            }
            a.C.Step(a.Target,CentreOmega,1,dt);
        }
        void StartLanding(Axis a,double line,int dir,double v) {
            // Handed over at the rest line, the trailing edge keeps its real
            // impact speed (the library takes .9 of it as the lead reaches its
            // rest, which here is the moment of handover), so the squash
            // scales with how hard the bar hits.
            a.Mode=Mode.Land;a.Dir=dir;a.Carried=true;if(a==x)ImpactX=true;else ImpactY=true;
            a.Lead.Value=line+dir*a.Rest/2;a.Lead.Velocity=v;
            a.Trail.Value=line-dir*a.Rest/2;a.Trail.Velocity=v;
            a.RestLead=line+dir*a.Rest/2;a.RestTrail=line-dir*a.Rest/2;a.Wall=a.RestLead+dir*a.Give;a.Target=line;
        }
        // The leading edge springs to its rest and stops at the wall; the
        // trailing edge keeps its speed until the lead is within ImpactReach
        // bar heights of its rest, then keeps Carry of it and swings in on a
        // soft spring, overshooting (the squash) before it recovers.
        void StepLanding(Axis l,double dt) {
            l.Lead.Step(l.RestLead,CentreOmega,1,dt);
            if((l.Lead.Value-l.Wall)*l.Dir>0){l.Lead.Value=l.Wall;if(l.Lead.Velocity*l.Dir>0)l.Lead.Velocity=0;}
            if(!l.Carried&&(l.RestLead-l.Lead.Value)*l.Dir<=ImpactReach*restH){l.Trail.Velocity*=Carry;l.Carried=true;if(l==x)ImpactX=true;else ImpactY=true;}
            double behind=Math.Max(0,(l.RestTrail-l.Trail.Value)*l.Dir)/restW;
            if(l.Trail.Velocity*l.Dir>0)l.Trail.Step(l.RestTrail,TrailingInOmega*(1+TrailingStiffening*behind),TrailingInZeta,dt);
            else l.Trail.Step(l.RestTrail,RecoveryOmega,1,dt);
            // Never shorter than MinAlong, never longer than its rest.
            double least=MinAlong*l.Rest,length=(l.Lead.Value-l.Trail.Value)*l.Dir;
            if(length<least){l.Trail.Value=l.Lead.Value-l.Dir*least;if(l.Trail.Velocity*l.Dir>0)l.Trail.Velocity=0;}
            else if(length>l.Rest){l.Trail.Value=l.Lead.Value-l.Dir*l.Rest;if(l.Trail.Velocity*l.Dir<0)l.Trail.Velocity=0;}
        }
        bool Quiet() {
            if(Math.Abs(strainU.Value)>.005||Math.Abs(strainV.Value)>.005||Math.Abs(strainU.Velocity)>.05||Math.Abs(strainV.Velocity)>.05||Math.Abs(drive.Value)>.01)return false;
            return Math.Abs(x.C.Value-x.Target)<.25&&Math.Abs(x.C.Velocity)<1.5&&Math.Abs(y.C.Value-y.Target)<.25&&Math.Abs(y.C.Velocity)<1.5;
        }
        // How far the ends of the bar may rise or fall from a diagonal stretch, in pixels.
        internal double LeanPx {get {return LeanMost*scale;}}
        // The body's shape as a 2 x 2 matrix about its centre (x' = a x + b y,
        // y' = c x + d y): cosh ρ·I + (sinh ρ/ρ)·[[u, v], [v, -u]], ρ = hypot(u, v).
        internal void Shape(out double a,out double b,out double c,out double d) {
            double u=strainU.Value,v=strainV.Value,rho=Math.Sqrt(u*u+v*v),k=rho<1e-9?1:Math.Sinh(rho)/rho;
            // The lean: a diagonal stretch tilts a long bar; its ends move at most LeanMost DIP.
            double most=LeanPx/(restW/2);
            if(Math.Abs(k*v)>most){v=Math.Sign(v)*most/k;rho=Math.Sqrt(u*u+v*v);k=rho<1e-9?1:Math.Sinh(rho)/rho;}
            double ch=Math.Cosh(rho);
            a=ch+k*u;d=ch-k*u;b=c=k*v;
            // During a landing the edges are the drawn extent, as in the
            // library, and the bar swells on the other axis (bar.squash): by
            // the inverse square root of the squash, at most e^MaxStrain.
            double most2=Math.Exp(MaxStrain);
            if(x.Mode==Mode.Land){a=AlongX;b=c=0;if(y.Mode!=Mode.Land)d=Math.Min(most2,d/Math.Sqrt(AlongX));}
            if(y.Mode==Mode.Land){d=AlongY;b=c=0;if(x.Mode!=Mode.Land)a=Math.Min(most2,a/Math.Sqrt(AlongY));}
            if(!haveLimits)return;
            // Never drawn past the screen's edge: a landing axis keeps its
            // edges and the other is held to its room; otherwise the whole
            // shape is eased towards rest until it fits.
            double roomX=Room(x,restW),roomY=Room(y,restH);
            if(x.Mode==Mode.Land||y.Mode==Mode.Land) {
                if(x.Mode!=Mode.Land)a=Math.Min(a,Math.Max(1,roomX/(restW/2)));
                if(y.Mode!=Mode.Land)d=Math.Min(d,Math.Max(1,roomY/(restH/2)));
                return;
            }
            if(Fits(a,b,c,d,roomX,roomY))return;
            double lo=0,hi=1;
            for(int i=0;i<12;i++){double m=(lo+hi)/2;if(Fits(1+m*(a-1),m*b,m*c,1+m*(d-1),roomX,roomY))lo=m;else hi=m;}
            a=1+lo*(a-1);b*=lo;c*=lo;d=1+lo*(d-1);
        }
        double Room(Axis a,double rest) {return Math.Min(a.High+rest/2+a.Give-a.Centre,a.Centre-(a.Low-rest/2-a.Give));}
        bool Fits(double a,double b,double c,double d,double roomX,double roomY) {
            return Math.Abs(a)*restW/2+Math.Abs(b)*restH/2<=Math.Max(roomX,restW/2)+.01&&Math.Abs(c)*restW/2+Math.Abs(d)*restH/2<=Math.Max(roomY,restH/2)+.01;
        }
    }
}
