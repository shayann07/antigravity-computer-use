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
        // From the library (Calm): the centre's critical spring; the stretch's
        // drive and shape springs; the held reference speed; the two-edge landing.
        internal const double CentreOmega=24,DriveOmega=10,ShapeOmega=32,ShapeZeta=.72,HeldReference=8,TravelStrain=.6;
        internal const double TrailingInOmega=9,TrailingInZeta=.3,TrailingStiffening=.5,RecoveryOmega=13,Carry=.1,ImpactReach=.3,ImpactSpeed=.6;
        internal const double FingerTau=.035,StopWindow=.040,StopTau=.060,Step=1/240.0,FineStep=1/960.0,LongestCatchUp=.5;
        // Departures for a 440 x 48 desktop bar: a "slot" is BodySlot DIP;
        // the stretch is capped at MaxStrain (the library allows .336); an
        // edge never shortens below MinAlong of its resting length; the wall
        // is the work area's edge, so the give is the dock's own inset.
        internal const double BodySlot=96,MaxStrain=.2,MinAlong=.6,FlingSpeed=420;

        sealed class Landing {
            internal BodySpring Lead,Trail;internal int Dir;internal double RestLead,RestTrail,Wall,Rest;internal bool Carried;
        }
        readonly double restW,restH,slot;
        BodySpring cx,cy,drive,strain;
        Landing landX,landY;
        double targetX,targetY,angle,fingerVX,fingerVY,sinceSample,lastFingerX,lastFingerY,heldDirX,heldDirY,reversal=1;
        bool held,haveFinger;
        internal bool Done=true;
        // Whether the trailing edge took its impact on each axis since the last release.
        internal bool ImpactX,ImpactY;

        // restW, restH and scale in device pixels for the bar's monitor.
        internal BarBody(double restW,double restH,double scale) {this.restW=restW;this.restH=restH;slot=BodySlot*scale;}
        internal bool Held {get {return held;}}
        internal double CentreX {get {return landX!=null?(landX.Lead.Value+landX.Trail.Value)/2:cx.Value;}}
        internal double CentreY {get {return landY!=null?(landY.Lead.Value+landY.Trail.Value)/2:cy.Value;}}
        internal double VelocityX {get {return landX!=null?(landX.Lead.Velocity+landX.Trail.Velocity)/2:cx.Velocity;}}
        internal double VelocityY {get {return landY!=null?(landY.Lead.Velocity+landY.Trail.Velocity)/2:cy.Velocity;}}
        internal double Strain {get {return strain.Value;}}
        // Length along each axis as a share of rest: below 1 while pressed against a wall.
        internal double AlongX {get {return landX==null?1:Math.Max(MinAlong,Math.Abs(landX.Lead.Value-landX.Trail.Value)/landX.Rest);}}
        internal double AlongY {get {return landY==null?1:Math.Max(MinAlong,Math.Abs(landY.Lead.Value-landY.Trail.Value)/landY.Rest);}}

        // The person holds the bar: its centre follows the pointer exactly, and
        // the pointer's filtered speed drives the stretch.
        internal void Hold(double x,double y,double dt) {
            if(!held||!haveFinger){Grab(x,y);return;}
            if(dt>0) {
                double k=1-Math.Exp(-dt/FingerTau);
                fingerVX+=((x-lastFingerX)/dt-fingerVX)*k;fingerVY+=((y-lastFingerY)/dt-fingerVY)*k;
            }
            lastFingerX=x;lastFingerY=y;sinceSample=0;
            cx.Value=x;cy.Value=y;cx.Velocity=fingerVX;cy.Velocity=fingerVY;
        }
        // Caught, mid-flight or at rest: the body is held where it is.
        internal void Grab(double x,double y) {
            double vx=VelocityX,vy=VelocityY;
            landX=landY=null;held=true;haveFinger=true;Done=false;
            cx.Value=x;cy.Value=y;cx.Velocity=fingerVX=vx;cy.Velocity=fingerVY=vy;
            lastFingerX=x;lastFingerY=y;sinceSample=0;
        }
        internal double FingerSpeed {get {return Math.Sqrt(fingerVX*fingerVX+fingerVY*fingerVY);}}
        internal double FingerVX {get {return fingerVX;}}
        internal double FingerVY {get {return fingerVY;}}

        // Let go towards a resting centre. wallX and wallY say which screen
        // edge that rest sits against (-1, 0 or 1) and where that edge is.
        // The body keeps its own position and speed; only its targets change.
        internal void Release(double toX,double toY,int sideX,double wallX,int sideY,double wallY) {
            held=false;haveFinger=false;Done=false;targetX=toX;targetY=toY;ImpactX=ImpactY=false;
            landX=Land(cx,toX,sideX,wallX,restW);landY=Land(cy,toY,sideY,wallY,restH);
        }
        Landing Land(BodySpring c,double to,int side,double wall,double rest) {
            // The two-edge landing runs only when the bar flies into the edge
            // its dock is against, faster than ImpactSpeed of its width a second.
            if(side==0||c.Velocity*side<=ImpactSpeed*restW)return null;
            Landing l=new Landing();l.Dir=side;l.Rest=rest;
            l.Lead.Value=c.Value+side*rest/2;l.Lead.Velocity=c.Velocity;
            l.Trail.Value=c.Value-side*rest/2;l.Trail.Velocity=c.Velocity;
            l.RestLead=to+side*rest/2;l.RestTrail=to-side*rest/2;l.Wall=wall;
            return l;
        }
        // Puts the body at rest at once (reduced motion, hiding, a new place).
        internal void Snap(double x,double y) {
            held=false;haveFinger=false;landX=landY=null;Done=true;
            cx.Value=targetX=x;cy.Value=targetY=y;cx.Velocity=cy.Velocity=fingerVX=fingerVY=0;
            drive=new BodySpring();strain=new BodySpring();
        }

        internal void Advance(double seconds) {
            if(Done)return;
            seconds=Math.Min(seconds,LongestCatchUp);
            while(seconds>1e-9) {
                double dt=Math.Min(seconds,landX!=null||landY!=null?FineStep:Step);
                Substep(dt);seconds-=dt;
            }
            if(!held&&Quiet()){Snap(targetX,targetY);}
        }
        void Substep(double dt) {
            if(held) {
                sinceSample+=dt;
                if(sinceSample>StopWindow){double k=Math.Exp(-dt/StopTau);fingerVX*=k;fingerVY*=k;cx.Velocity=fingerVX;cy.Velocity=fingerVY;}
            } else {
                if(landX!=null)StepLanding(landX,dt);else cx.Step(targetX,CentreOmega,1,dt);
                if(landY!=null)StepLanding(landY,dt);else cy.Step(targetY,CentreOmega,1,dt);
            }
            // The stretch: an area-preserving strain along the direction of
            // travel, driven by speed while held, relaxing (with a little
            // wobble) once let go.
            double vx=held?fingerVX:VelocityX,vy=held?fingerVY:VelocityY,speed=Math.Sqrt(vx*vx+vy*vy)/slot;
            if(speed>.5)angle=Math.Atan2(vy,vx);
            // A scrub back and forth does not build the stretch: a reversal
            // within .28 s keeps .4 of it (.85 otherwise), and it rebuilds
            // over the next .25 s.
            double suppression=1;
            if(held) {
                reversal+=dt;
                if(speed>.1) {
                    double ux=vx/(speed*slot),uy=vy/(speed*slot);
                    if((heldDirX!=0||heldDirY!=0)&&ux*heldDirX+uy*heldDirY<0){drive.Value*=reversal<.28?.4:.85;drive.Velocity=0;reversal=0;}
                    heldDirX=ux;heldDirY=uy;
                }
                suppression=Math.Max(.15,Math.Min(1,reversal/.25));
            } else {heldDirX=heldDirY=0;reversal=1;}
            double sv=held?suppression*speed*speed/(HeldReference*HeldReference+speed*speed):0;
            drive.Step(sv,DriveOmega,1,dt);
            strain.Step(Math.Max(0,Math.Min(MaxStrain,TravelStrain*drive.Value)),ShapeOmega,ShapeZeta,dt);
        }
        // The leading edge springs to its rest and stops at the wall; the
        // trailing edge keeps its speed until the lead is within ImpactReach
        // bar heights of its rest, then keeps Carry of it and swings in on a
        // soft spring, overshooting (the squash) before it recovers.
        void StepLanding(Landing l,double dt) {
            l.Lead.Step(l.RestLead,CentreOmega,1,dt);
            if((l.Lead.Value-l.Wall)*l.Dir>0){l.Lead.Value=l.Wall;if(l.Lead.Velocity*l.Dir>0)l.Lead.Velocity=0;}
            if(!l.Carried&&(l.RestLead-l.Lead.Value)*l.Dir<=ImpactReach*restH){l.Trail.Velocity*=Carry;l.Carried=true;if(l==landX)ImpactX=true;else ImpactY=true;}
            double behind=Math.Max(0,(l.RestTrail-l.Trail.Value)*l.Dir)/restW;
            if(l.Trail.Velocity*l.Dir>0)l.Trail.Step(l.RestTrail,TrailingInOmega*(1+TrailingStiffening*behind),TrailingInZeta,dt);
            else l.Trail.Step(l.RestTrail,RecoveryOmega,1,dt);
            // Never shorter than MinAlong of its rest: the trailing edge stops there.
            double least=MinAlong*l.Rest;
            if((l.Lead.Value-l.Trail.Value)*l.Dir<least){l.Trail.Value=l.Lead.Value-l.Dir*least;if(l.Trail.Velocity*l.Dir>0)l.Trail.Velocity=0;}
        }
        bool Quiet() {
            if(Math.Abs(strain.Value)>.005||Math.Abs(strain.Velocity)>.05||Math.Abs(drive.Value)>.01)return false;
            if(!QuietAxis(landX,cx,targetX)||!QuietAxis(landY,cy,targetY))return false;
            return true;
        }
        static bool QuietAxis(Landing l,BodySpring c,double target) {
            if(l==null)return Math.Abs(c.Value-target)<.25&&Math.Abs(c.Velocity)<1.5;
            return Math.Abs(l.Lead.Value-l.RestLead)<.25&&Math.Abs(l.Trail.Value-l.RestTrail)<.25&&Math.Abs(l.Lead.Velocity)<1.5&&Math.Abs(l.Trail.Velocity)<1.5;
        }
        // The body's shape as a 2 x 2 matrix about its centre (x' = a x + b y,
        // y' = c x + d y). The strain is the library's area-preserving one
        // without its shear term: on a bar this long a diagonal stretch would
        // tilt it, so travel along x widens and flattens it, travel along y
        // narrows and heightens it, and a diagonal does a share of each.
        internal void Shape(out double a,out double b,out double c,out double d) {
            double u=strain.Value*Math.Cos(2*angle),s11=Math.Exp(u),s22=Math.Exp(-u);
            // During a landing the edges are the drawn extent, as in the
            // library: the strain is divided out on that axis, so the drawn
            // bar never reaches past its edges or the wall.
            a=landX!=null?AlongX:s11;d=landY!=null?AlongY:s22;b=c=0;
        }
    }
}
