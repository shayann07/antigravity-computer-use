using LiquidGlass.Skia;
using SkiaSharp;
using System.Reflection;
using System.Xml.Linq;

byte[] Render(int width, int height, string state) {
    if (width < 16 || height < 16 || width > 4096 || height > 4096)
        throw new ArgumentOutOfRangeException(nameof(width));
    using var surface = SKSurface.Create(new SKImageInfo(width, height, SKColorType.Bgra8888, SKAlphaType.Premul));
    var canvas = surface.Canvas;
    canvas.Clear(new SKColor(7, 10, 18, 255));
    using var painter = new GlassPainter();
    var inset = Math.Clamp(Math.Min(width, height) * 0.04f, 1f, 4f);
    var bounds = new SKRect(inset, inset, width - inset, height - inset);
    var radius = Math.Max(1f, Math.Min(height / 2f - inset, 21f));
    painter.RecordBackdrop(width, height, c => {
        c.Clear(new SKColor(7, 10, 18, 255));
        using var backdrop = new SKPaint { Color = new SKColor(22, 28, 42, 255) };
        c.DrawRoundRect(bounds, radius, radius, backdrop);
    }, new SKColor(7, 10, 18, 255));
    var options = new GlassSurfaceOptions(
        Dark: true, TintAmount: 0f, Density: 1f, Materialize: 1f,
        ReducedTransparency: 0f, IncreasedContrast: 0f, LightX: 0f, LightY: -1f);
    painter.DrawSurface(canvas, bounds, radius, options);
    var scaleX = width / 468f;
    var scaleY = height / 50f;
    canvas.Save();
    canvas.Scale(scaleX, scaleY);
    Phosphor.Draw(canvas, "sliders-horizontal-fill", 281, 13, 26);
    Phosphor.Draw(canvas, state == "active" ? "pause-fill" : "play-fill", 333, 13, 26);
    Phosphor.Draw(canvas, state == "stopped" ? "x-fill" : "stop-fill", 389, 15, 22);
    canvas.Restore();
    using var image = surface.Snapshot();
    using var data = image.Encode(SKEncodedImageFormat.Png, 100);
    return data.ToArray();
}

if (args.Length > 0 && args[0].Equals("--stdio", StringComparison.OrdinalIgnoreCase)) {
    string? line;
    while ((line = Console.ReadLine()) is not null) {
        var parts = line.Split('|');
        if (parts.Length != 3 || !int.TryParse(parts[0], out var width) || !int.TryParse(parts[1], out var height)) {
            Console.WriteLine("error|invalid_request"); Console.Out.Flush(); continue;
        }
        try { Console.WriteLine(Convert.ToBase64String(Render(width, height, parts[2]))); }
        catch { Console.WriteLine("error|render_failed"); }
        Console.Out.Flush();
    }
} else {
    if (args.Length < 1) throw new ArgumentException("output PNG path is required");
    var output = Path.GetFullPath(args[0]);
    var width = args.Length > 1 && int.TryParse(args[1], out var parsedWidth) ? parsedWidth : 940;
    var height = args.Length > 2 && int.TryParse(args[2], out var parsedHeight) ? parsedHeight : 104;
    var state = args.Length > 3 ? args[3] : "active";
    Directory.CreateDirectory(Path.GetDirectoryName(output)!);
    File.WriteAllBytes(output, Render(width, height, state));
}

static class Phosphor {
    static readonly Dictionary<string, SKPath> Paths = new();
    internal static void Draw(SKCanvas canvas, string name, float x, float y, float size) {
        if (!Paths.TryGetValue(name, out var path)) {
            using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream($"Icons.{name}.svg")
                ?? throw new InvalidOperationException($"Missing embedded icon {name}");
            var svg = XDocument.Load(stream);
            var data = svg.Descendants().First(e => e.Name.LocalName == "path").Attribute("d")?.Value
                ?? throw new InvalidOperationException($"Missing icon path {name}");
            path = SKPath.ParseSvgPathData(data) ?? throw new InvalidOperationException($"Invalid icon path {name}");
            Paths.Add(name, path);
        }
        using var paint = new SKPaint { Color = new SKColor(232, 239, 245), IsAntialias = true, Style = SKPaintStyle.Fill };
        canvas.Save();
        canvas.Translate(x, y);
        canvas.Scale(size / 256f);
        canvas.DrawPath(path, paint);
        canvas.Restore();
    }
}
