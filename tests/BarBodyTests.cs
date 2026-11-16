using System;using Axon;
internal static class BarBodyTests {
    static int count;
    static void Check(bool ok,string name) {if(!ok)throw new Exception(name);count++;Console.WriteLine("PASS "+name);}
    // A 440 x 48 bar on a 1920 x 1040 work area at 100%: dock centres 12 px in from the sides, 18 from top and bottom.
    const double W=440,H=48,Right=1920,Bottom=1040;
    static double DockX(int side){return side<0?12+W/2:side>0?Right-12-W/2:Right/2;}
    static double DockY(int side){return side<0?18+H/2:Bottom-18-H/2;}
    // Drags at (vx, vy) px/s for 0.2 s from (x, y), lets go towards a dock, and runs it to rest.
    static void Throw(string name,double x,double y,double vx,double vy,int sideX,int sideY,bool expectX,bool expectY,bool squash) {
        BarBody b=new BarBody(W,H,1);double dt=1/120.0;
        b.Grab(x,y);
        for(int i=1;i<=24;i++){x+=vx*dt;y+=vy*dt;b.Hold(x,y,dt);b.Advance(dt);}
        double strainHeld=b.Strain,tx=DockX(sideX),ty=DockY(sideY);
        b.Release(tx,ty,sideX,sideX<0?0:Right,sideY,sideY<0?0:Bottom);
        double t=0,minX=1,minY=1,maxStrain=0,overshootX=0,outside=0;
        while(!b.Done&&t<3) {
            b.Advance(1/60.0);t+=1/60.0;
            minX=Math.Min(minX,b.AlongX);minY=Math.Min(minY,b.AlongY);maxStrain=Math.Max(maxStrain,Math.Abs(b.Strain));
            if(sideX==0)overshootX=Math.Max(overshootX,Math.Abs(b.CentreX-tx)-Math.Abs(x-tx));
            double a,s,c,d;b.Shape(out a,out s,out c,out d);double ex=Math.Abs(a)*W/2+Math.Abs(s)*H/2,ey=Math.Abs(c)*W/2+Math.Abs(d)*H/2;
            double left=b.CentreX-ex,right=b.CentreX+ex,top=b.CentreY-ey,bottom=b.CentreY+ey;
            outside=Math.Max(outside,Math.Max(Math.Max(-left,right-Right),Math.Max(-top,bottom-Bottom)));
        }
        Console.WriteLine(String.Format("{0,-12} held strain {1:0.000}  impact x/y {2}/{3}  least length x {4:0.00} y {5:0.00}  settled {6:0.00} s  outside {7:0.0} px  at ({8:0.0}, {9:0.0}) target ({10}, {11})",
            name,strainHeld,b.ImpactX,b.ImpactY,minX,minY,t,outside,b.CentreX,b.CentreY,tx,ty));
        Check(b.Done&&t<1.5,name+": settles within 1.5 s");
        Check(Math.Abs(b.CentreX-tx)<.01&&Math.Abs(b.CentreY-ty)<.01&&b.AlongX==1&&b.AlongY==1&&b.Strain==0,name+": rests exactly on its dock, unsquashed");
        Check(b.ImpactX==expectX&&b.ImpactY==expectY,name+": the edge it flies into takes the impact");
        Check(minX>=BarBody.MinAlong&&minY>=BarBody.MinAlong,name+": never shorter than MinAlong");
        Check(outside<=0.5,name+": stays inside the work area");
        if(squash&&expectX)Check(minX<.97,name+": visibly squashed against the side");
        if(squash&&expectY)Check(minY<.97,name+": visibly squashed against the top or bottom");
    }
    static int Main() {
        try {
            Throw("corner",900,500,2500,-1500,1,-1,true,true,true);
            Throw("top centre",960,600,0,-2000,0,-1,false,true,true);
            Throw("along wall",500,42,3000,0,1,-1,true,false,true);
            // A gentle hop meets the edge but barely presses into it.
            Throw("short hop",1500,42,800,0,1,-1,true,false,false);
            BarBody held=new BarBody(W,H,1);held.Grab(500,500);double x=500;
            for(int i=0;i<60;i++){x+=1500/120.0;held.Hold(x,500,1/120.0);held.Advance(1/120.0);}
            Check(held.Strain>.05&&held.Strain<=BarBody.MaxStrain+1e-9,"a held drag stretches, up to MaxStrain");
            double a,bb,c,d;held.Shape(out a,out bb,out c,out d);
            Check(Math.Abs(a*d-bb*c-1)<1e-6&&a>1&&d<1,"the stretch along the travel keeps the area");
            for(int i=0;i<30;i++){x+=(i%2==0?1:-1)*1500/120.0*6;held.Hold(x,500,1/120.0);held.Advance(1/120.0);}
            Check(held.Strain<.06,"scrubbing back and forth does not build the stretch");
            BarBody slow=new BarBody(W,H,1);slow.Grab(700,400);slow.Release(700,400,0,0,0,0);slow.Advance(.2);
            Check(slow.Done&&slow.CentreX==700,"a still release is at rest at once");
            BarBody snap=new BarBody(W,H,1);snap.Grab(700,400);snap.Snap(DockX(1),DockY(-1));
            Check(snap.Done&&snap.CentreX==DockX(1)&&snap.Strain==0,"a snap (reduced motion) puts it on the dock");
            Console.WriteLine("TOTAL "+count);return 0;
        } catch(Exception e) {Console.WriteLine("FAIL "+e.Message);return 1;}
    }
}
