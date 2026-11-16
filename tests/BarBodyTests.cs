using System;using Axon;
internal static class BarBodyTests {
    static int count;
    static void Check(bool ok,string name) {if(!ok)throw new Exception(name);count++;Console.WriteLine("PASS "+name);}
    // A 440 x 48 bar on a 1920 x 1040 work area at 100%: centres rest 12 px
    // in from the sides (232..1688) and 18 from top and bottom (42..998).
    const double W=440,H=48,Right=1920,Bottom=1040,LowX=232,HighX=1688,LowY=42,HighY=998;
    static readonly double[] DocksX={LowX,960,HighX,LowX,960,HighX},DocksY={LowY,LowY,LowY,HighY,HighY,HighY};
    // Drags at (vx, vy) px/s for 0.2 s ending at (x, y), lets go, and runs it to rest.
    static BarBody Throw(string name,double x,double y,double vx,double vy,bool thrown,bool impactX,bool impactY,double restX,double restY) {
        BarBody b=new BarBody(W,H,1);double dt=1/120.0;b.Limits(LowX,HighX,12,LowY,HighY,18);
        x-=vx*.2;y-=vy*.2;b.Grab(x,y);
        for(int i=1;i<=24;i++){x+=vx*dt;y+=vy*dt;b.Hold(x,y,dt);b.Advance(dt);}
        double release=Math.Sqrt(b.FingerVX*b.FingerVX+b.FingerVY*b.FingerVY);
        b.Release(thrown,LowX,HighX,12,LowY,HighY,18,DocksX,DocksY,12);
        double t=0,minX=1,minY=1,maxX=0,maxY=0,outside=0;
        double heldOutside=0;{double a0,s0,c0,d0;b.Shape(out a0,out s0,out c0,out d0);double hx=Math.Abs(a0)*W/2+Math.Abs(s0)*H/2,hy=Math.Abs(c0)*W/2+Math.Abs(d0)*H/2;heldOutside=Math.Max(Math.Max(b.CentreX+hx-Right,hx-b.CentreX),Math.Max(b.CentreY+hy-Bottom,hy-b.CentreY));}
        Check(heldOutside<=0.5,name+": the held stretch stays on screen");
        while(!b.Done&&t<5) {
            b.Advance(1/60.0);t+=1/60.0;
            double a,s,c,d;b.Shape(out a,out s,out c,out d);
            minX=Math.Min(minX,b.AlongX);minY=Math.Min(minY,b.AlongY);maxX=Math.Max(maxX,b.AlongX);maxY=Math.Max(maxY,b.AlongY);
            double ex=Math.Abs(a)*W/2+Math.Abs(s)*H/2,ey=Math.Abs(c)*W/2+Math.Abs(d)*H/2;
            outside=Math.Max(outside,Math.Max(Math.Max(ex-b.CentreX,b.CentreX+ex-Right),Math.Max(ey-b.CentreY,b.CentreY+ey-Bottom)));
        }
        Console.WriteLine(String.Format("{0,-14} release {1,5:0} px/s  peak {2,5:0}  impact x/y {3}/{4}  length x {5:0.00}-{6:0.00} y {7:0.00}-{8:0.00}  settled {9:0.00} s  outside {10:0.0} px  at ({11:0.0}, {12:0.0})",
            name,release,b.PeakSpeed,b.ImpactX,b.ImpactY,minX,maxX,minY,maxY,t,outside,b.CentreX,b.CentreY));
        Check(b.Done&&t<3,name+": settles within 3 s");
        Check(Math.Abs(b.CentreX-restX)<3&&Math.Abs(b.CentreY-restY)<3,name+": rests where its momentum takes it ("+restX+", "+restY+")");
        Check(b.AlongX==1&&b.AlongY==1&&b.Strain==0,name+": rests unsquashed and unstretched");
        Check(b.PeakSpeed<=release*1.05+1,name+": never faster than it was thrown");
        Check(b.ImpactX==impactX&&b.ImpactY==impactY,name+": only an edge it reaches fast takes an impact");
        Check(minX>=BarBody.MinAlong&&minY>=BarBody.MinAlong&&maxX<=1&&maxY<=1,name+": length stays between MinAlong and its rest");
        Check(outside<=0.5,name+": stays inside the work area");
        if(impactX)Check(minX<.97,name+": visibly squashed against the side");
        if(impactY)Check(minY<.97,name+": visibly squashed against the top or bottom");
        return b;
    }
    static int Main() {
        try {
            Throw("corner",900,500,3000,-2000,true,true,true,HighX,LowY);
            Throw("long open",300,500,1500,0,true,false,false,300+1500*BarBody.Glide,500);
            Throw("along the top",500,42,4000,0,true,true,false,HighX,LowY);
            Throw("up to top",960,600,0,-3000,true,false,true,960,LowY);
            Throw("put down",700,400,300,0,false,false,false,700,400);
            Throw("near a dock",1680,50,200,0,false,false,false,HighX,LowY);
            // Let go inside the top margin, flung at the top edge: it still squashes.
            Throw("flick at top",960,36,0,-2500,true,false,true,960,LowY);
            BarBody held=new BarBody(W,H,1);held.Grab(500,500);double x=500;
            for(int i=0;i<60;i++){x+=1500/120.0;held.Hold(x,500,1/120.0);held.Advance(1/120.0);}
            Check(held.Strain>.05&&held.Strain<=BarBody.MaxStrain+1e-9,"a held drag stretches, up to MaxStrain");
            double a,bb,c,d;held.Shape(out a,out bb,out c,out d);
            Check(Math.Abs(a*d-bb*c-1)<1e-9&&a>1&&Math.Abs(bb)<1e-9,"a sideways drag stretches sideways and keeps the area");
            BarBody up=new BarBody(W,H,1);up.Grab(500,800);double yy=800;
            for(int i=0;i<60;i++){yy-=1500/120.0;up.Hold(500,yy,1/120.0);up.Advance(1/120.0);}
            up.Shape(out a,out bb,out c,out d);Check(a<1&&d>1,"a vertical drag heightens the bar instead");
            for(int i=0;i<30;i++){x+=(i%2==0?1:-1)*1500/120.0*6;held.Hold(x,500,1/120.0);held.Advance(1/120.0);}
            Check(held.Strain<.06,"scrubbing back and forth does not build the stretch");
            // bar.stretch in every direction: drag 0.3 s at 1500 px/s every 15 degrees in open space.
            double[] prev=null;
            for(int deg=0;deg<360;deg+=15) {
                BarBody s2=new BarBody(W,H,1);s2.Limits(LowX,HighX,12,LowY,HighY,18);double px=960,py=520,th=deg*Math.PI/180;s2.Grab(px,py);
                for(int i=0;i<36;i++){px+=Math.Cos(th)*1500/120.0;py+=Math.Sin(th)*1500/120.0;s2.Hold(px,py,1/120.0);s2.Advance(1/120.0);}
                double a2,b2,c2,d2;s2.Shape(out a2,out b2,out c2,out d2);
                // The stretched direction: the larger eigenvector of the symmetric shape.
                double axis=.5*Math.Atan2(2*b2,a2-d2),diff=Math.Abs(Math.IEEERemainder(axis-th,Math.PI));
                double lean=Math.Abs(c2)*W/2;bool capped=lean>=s2.LeanPx-.5;
                Console.WriteLine(String.Format("stretch {0,3} deg  strain {1:0.000}  axis {2,6:0.0}  lean {3,5:0.0} px{4}",deg,s2.Strain,axis*180/Math.PI,lean,capped?"  (lean capped)":""));
                Check(s2.Strain>.1,"a drag at "+deg+" degrees stretches");
                Check(lean<=s2.LeanPx+.01,"a drag at "+deg+" degrees leans at most LeanMost");
                Check(Math.Abs(a2*d2-b2*c2-1)<.02,"a drag at "+deg+" degrees keeps the area");
                if(!capped)Check(diff<.02||deg%90==0,"a drag at "+deg+" degrees stretches along its travel");
                if(deg%90==0)Check(diff<.02,"a drag at "+deg+" degrees stretches exactly along it");
            }
            // A one-degree change of direction barely changes the shape: no flip.
            for(int deg=40;deg<=50;deg++) {
                BarBody s3=new BarBody(W,H,1);s3.Limits(LowX,HighX,12,LowY,HighY,18);double px=960,py=520,th=deg*Math.PI/180;s3.Grab(px,py);
                for(int i=0;i<36;i++){px+=Math.Cos(th)*1500/120.0;py+=Math.Sin(th)*1500/120.0;s3.Hold(px,py,1/120.0);s3.Advance(1/120.0);}
                double a3,b3,c3,d3;s3.Shape(out a3,out b3,out c3,out d3);double[] now={a3,b3,d3};
                if(prev!=null)Check(Math.Abs(now[0]-prev[0])<.02&&Math.Abs(now[1]-prev[1])<.02&&Math.Abs(now[2]-prev[2])<.02,"from "+(deg-1)+" to "+deg+" degrees the shape changes smoothly");
                prev=now;
            }
            BarBody snap=new BarBody(W,H,1);snap.Grab(700,400);snap.Snap(HighX,LowY);
            Check(snap.Done&&snap.CentreX==HighX&&snap.Strain==0,"a snap (reduced motion) puts it on the dock");
            Console.WriteLine("TOTAL "+count);return 0;
        } catch(Exception e) {Console.WriteLine("FAIL "+e.Message);return 1;}
    }
}
