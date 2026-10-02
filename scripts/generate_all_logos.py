import os
import subprocess
import struct

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_LOGO = os.path.join(ROOT, "public", "logos", "logo.png")

def resize(src, dst, width, height):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    cmd = ["sips", "-z", str(height), str(width), src, "--out", dst]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"Error resizing {dst}: {res.stderr}")
    else:
        print(f"Generated: {dst}")

def make_ico(png_files_with_sizes, out_ico_path):
    images = []
    sizes = []
    for path, (w, h) in png_files_with_sizes:
        with open(path, "rb") as f:
            images.append(f.read())
            sizes.append((w, h))

    num_images = len(images)
    header = struct.pack("<HHH", 0, 1, num_images)

    offset = 6 + 16 * num_images
    dir_entries = []

    for i, data in enumerate(images):
        w, h = sizes[i]
        w_byte = 0 if w >= 256 else w
        h_byte = 0 if h >= 256 else h
        entry = struct.pack("<BBBBHHII", w_byte, h_byte, 0, 0, 1, 32, len(data), offset)
        dir_entries.append(entry)
        offset += len(data)

    os.makedirs(os.path.dirname(out_ico_path), exist_ok=True)
    with open(out_ico_path, "wb") as f:
        f.write(header)
        for entry in dir_entries:
            f.write(entry)
        for data in images:
            f.write(data)
    print(f"Generated ICO: {out_ico_path}")

def main():
    if not os.path.exists(SRC_LOGO):
        raise FileNotFoundError(f"Source logo not found at {SRC_LOGO}")

    print(f"Using source logo: {SRC_LOGO}")

    # Chrome Extension icons
    ext_dir = os.path.join(ROOT, "chrome-extension", "public", "icons")
    resize(SRC_LOGO, os.path.join(ext_dir, "icon16.png"), 16, 16)
    resize(SRC_LOGO, os.path.join(ext_dir, "icon32.png"), 32, 32)
    resize(SRC_LOGO, os.path.join(ext_dir, "icon48.png"), 48, 48)
    resize(SRC_LOGO, os.path.join(ext_dir, "icon128.png"), 128, 128)

    # Web App public icons
    pub_icons = os.path.join(ROOT, "public", "icons")
    sizes = [16, 32, 72, 96, 128, 144, 152, 192, 384, 512]
    for s in sizes:
        if s in (16, 32):
            resize(SRC_LOGO, os.path.join(pub_icons, f"favicon-{s}x{s}.png"), s, s)
        resize(SRC_LOGO, os.path.join(pub_icons, f"icon-{s}x{s}.png"), s, s)
        resize(SRC_LOGO, os.path.join(pub_icons, f"icon-{s}x{s}-maskable.png"), s, s)

    # Web App root public images
    resize(SRC_LOGO, os.path.join(ROOT, "public", "favicon.png"), 32, 32)
    resize(SRC_LOGO, os.path.join(ROOT, "public", "apple-touch-icon.png"), 180, 180)
    resize(SRC_LOGO, os.path.join(ROOT, "public", "icon.png"), 512, 512)

    # Next.js App Router icons
    resize(SRC_LOGO, os.path.join(ROOT, "app", "icon.png"), 512, 512)
    resize(SRC_LOGO, os.path.join(ROOT, "app", "apple-icon.png"), 180, 180)

    # Generate ICO files (16x16, 32x32, 48x48)
    png16 = os.path.join(pub_icons, "favicon-16x16.png")
    png32 = os.path.join(pub_icons, "favicon-32x32.png")
    png48 = os.path.join(ext_dir, "icon48.png")

    ico_inputs = [(png16, (16, 16)), (png32, (32, 32)), (png48, (48, 48))]
    make_ico(ico_inputs, os.path.join(ROOT, "public", "favicon.ico"))
    make_ico(ico_inputs, os.path.join(ROOT, "app", "favicon.ico"))

    print("All logos and icons generated successfully!")

if __name__ == "__main__":
    main()
