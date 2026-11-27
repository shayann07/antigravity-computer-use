using System;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Windows.Automation;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Web.WebView2.Core;

// UIA is read off the UI thread. The test sends text only to this embedded
// renderer, so a change in OS keyboard focus cannot send input to another app.
class EditorProbe : Form {
    protected override bool ShowWithoutActivation { get { return true; } }
    readonly WebView2 view = new WebView2();
    readonly string host;
    readonly string root;
    EditorProbe(string path, string dir) {
        host=path; root=dir; Text="Computer Use local editor test";
        Width=540; Height=270; ShowInTaskbar=false;
        view.Dock=DockStyle.Fill; Controls.Add(view);
        Shown += async delegate { try { await Run(); Environment.ExitCode=0; }
            catch(Exception ex){Console.Error.WriteLine(ex); Environment.ExitCode=1;} finally {Close();} };
    }
    async Task Run() {
        var env=await CoreWebView2Environment.CreateAsync(null,Path.Combine(root,"profile"),new CoreWebView2EnvironmentOptions("--force-renderer-accessibility"));
        await view.EnsureCoreWebView2Async(env);
        var loaded=new TaskCompletionSource<bool>();
        view.NavigationCompleted+=(sender,e)=>loaded.TrySetResult(e.IsSuccess);
        view.NavigateToString("<main><h1>New post</h1><div role='textbox' aria-label='Share your thoughts' contenteditable='true' id='editor'></div><button disabled id='post'>Post</button></main><script>editor.oninput=()=>{post.disabled=!editor.textContent};editor.onbeforeinput=e=>{if(window.mode==='ignore')e.preventDefault();if(window.mode==='partial'){e.preventDefault();editor.textContent='Draft';post.disabled=false}};</script>");
        if(!await loaded.Task)throw new Exception("Local page did not load");
        var hwnd=Handle;
        var program=Assembly.LoadFrom(host).GetType("Axon.Program",true);
        var flags=BindingFlags.NonPublic|BindingFlags.Static;
        var read=program.GetMethod("ReadElementText",flags);
        var verify=program.GetMethod("VerifyTextEdit",flags);
        await view.ExecuteScriptAsync("editor.focus()");
        AutomationElement target=null;
        for(int i=0;i<25 && target==null;i++){
            target=await Task.Run(()=>AutomationElement.FromHandle(hwnd).FindFirst(TreeScope.Descendants,new PropertyCondition(AutomationElement.NameProperty,"Share your thoughts")));
            if(target==null)await Task.Delay(100);
        }
        if(target==null)throw new Exception("UIA editor was not exposed");
        foreach(string mode in new[]{"ignore","partial","accept"}) {
            await view.ExecuteScriptAsync("window.mode='"+mode+"'; editor.textContent=''; post.disabled=true; editor.focus()");
            string before=await Task.Run(()=>(string)read.Invoke(null,new object[]{target}));
            if(before!="")throw new Exception("Expected a readable empty editor");
            await view.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.insertText","{\"text\":\"Draft check\"}");
            string outcome="confirmed";
            try{await Task.Run(()=>verify.Invoke(null,new object[]{target,before,"Draft check"}));}
            catch(TargetInvocationException ex){outcome=(string)ex.InnerException.GetType().GetField("Code").GetValue(ex.InnerException);}
            string dom=await view.ExecuteScriptAsync("[editor.textContent,post.disabled]");
            string expectedDom=mode=="ignore"?"[\"\",true]":mode=="partial"?"[\"Draft\",false]":"[\"Draft check\",false]";
            Console.WriteLine(mode+": native="+outcome+"; DOM="+dom);
            if(outcome!=(mode=="accept"?"confirmed":"input_outcome_unknown")||dom!=expectedDom)
                throw new Exception("Native result differs from fixture state");
        }
        Console.WriteLine("WebView2 "+env.BrowserVersionString);
    }
    [STAThread] static int Main(string[] args){Application.EnableVisualStyles();Application.Run(new EditorProbe(args[0],args[1]));return Environment.ExitCode;}
}
