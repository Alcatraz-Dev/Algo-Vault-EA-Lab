"use client";

import { useRef, useState } from "react";
import { Upload, X, Image as ImageIcon, Video, Trash2, Plus, Film, CheckCircle2 } from "lucide-react";

type Props = {
    imageUrl: string;
    videoUrl: string;
    images: string[];
    onImageUrlChange: (url: string) => void;
    onVideoUrlChange: (url: string) => void;
    onImagesChange: (images: string[]) => void;
};

export default function ProductMediaUpload({
    imageUrl,
    videoUrl,
    images,
    onImageUrlChange,
    onVideoUrlChange,
    onImagesChange,
}: Props) {
    const thumbnailInputRef = useRef<HTMLInputElement>(null);
    const videoInputRef = useRef<HTMLInputElement>(null);
    const screenshotsInputRef = useRef<HTMLInputElement>(null);
    const [showUrlInputs, setShowUrlInputs] = useState(false);

    const handleThumbnailFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 15 * 1024 * 1024) {
            alert("Thumbnail image must be smaller than 15MB.");
            return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
            if (event.target?.result) {
                onImageUrlChange(event.target.result as string);
            }
        };
        reader.readAsDataURL(file);
        e.target.value = "";
    };

    const handleVideoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 50 * 1024 * 1024) {
            alert("Video file must be smaller than 50MB.");
            return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
            if (event.target?.result) {
                onVideoUrlChange(event.target.result as string);
            }
        };
        reader.readAsDataURL(file);
        e.target.value = "";
    };

    const handleScreenshotsFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        const newImages: string[] = [];
        let readCount = 0;

        files.forEach((file) => {
            if (file.size > 15 * 1024 * 1024) {
                readCount++;
                return;
            }
            const reader = new FileReader();
            reader.onload = (event) => {
                if (event.target?.result) {
                    newImages.push(event.target.result as string);
                }
                readCount++;
                if (readCount === files.length) {
                    onImagesChange([...images, ...newImages]);
                }
            };
            reader.readAsDataURL(file);
        });
        e.target.value = "";
    };

    const removeScreenshot = (index: number) => {
        onImagesChange(images.filter((_, i) => i !== index));
    };

    return (
        <div className="space-y-6">
            <input
                ref={thumbnailInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={handleThumbnailFile}
            />
            <input
                ref={videoInputRef}
                type="file"
                accept="video/mp4,video/webm,video/ogg"
                className="hidden"
                onChange={handleVideoFile}
            />
            <input
                ref={screenshotsInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="hidden"
                onChange={handleScreenshotsFiles}
            />

            {/* 1. Primary Thumbnail Upload */}
            <div className="rounded-2xl border border-border/40 bg-card/60 p-4 backdrop-blur-xl">
                <div className="mb-3 flex items-center justify-between">
                    <div>
                        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <ImageIcon size={16} className="text-amber-400" />
                            Primary Image (Thumbnail Upload)
                        </h4>
                        <p className="text-xs text-muted-foreground">
                            Upload a high-quality product cover or thumbnail image.
                        </p>
                    </div>
                    {imageUrl && (
                        <button
                            type="button"
                            onClick={() => onImageUrlChange("")}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs text-red-400 transition hover:bg-red-500/20"
                        >
                            <Trash2 size={12} />
                            Remove
                        </button>
                    )}
                </div>

                {imageUrl ? (
                    <div className="relative overflow-hidden rounded-xl border border-border/40 bg-black/20 p-2 flex items-center gap-4">
                        <img
                            src={imageUrl}
                            alt="Thumbnail Preview"
                            className="h-20 w-28 rounded-lg object-cover border border-border/30"
                        />
                        <div>
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                                <CheckCircle2 size={13} />
                                Thumbnail Image Set
                            </span>
                            <div className="mt-2 flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => thumbnailInputRef.current?.click()}
                                    className="rounded-lg border border-border/40 bg-muted px-3 py-1.5 text-xs text-foreground transition hover:bg-foreground/10"
                                >
                                    Replace Image
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div
                        onClick={() => thumbnailInputRef.current?.click()}
                        className="group flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/20 p-6 text-center transition hover:border-amber-500/50 hover:bg-amber-500/[0.02]"
                    >
                        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400 transition group-hover:scale-105">
                            <Upload size={18} />
                        </div>
                        <span className="text-xs font-semibold text-foreground">Click to upload Thumbnail Image</span>
                        <span className="text-[11px] text-muted-foreground">PNG, JPG, WEBP up to 15MB</span>
                    </div>
                )}
            </div>

            {/* 2. Video Preview Upload / Embed */}
            <div className="rounded-2xl border border-border/40 bg-card/60 p-4 backdrop-blur-xl">
                <div className="mb-3 flex items-center justify-between">
                    <div>
                        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <Video size={16} className="text-blue-400" />
                            Video Demo / Preview
                        </h4>
                        <p className="text-xs text-muted-foreground">
                            Upload an MP4/WebM video file or paste YouTube/Vimeo embed link.
                        </p>
                    </div>
                    {videoUrl && (
                        <button
                            type="button"
                            onClick={() => onVideoUrlChange("")}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs text-red-400 transition hover:bg-red-500/20"
                        >
                            <Trash2 size={12} />
                            Remove Video
                        </button>
                    )}
                </div>

                {videoUrl ? (
                    <div className="rounded-xl border border-border/40 bg-black/20 p-3">
                        <div className="flex items-center justify-between">
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400">
                                <Film size={14} />
                                Video Attached / Linked
                            </span>
                            <button
                                type="button"
                                onClick={() => videoInputRef.current?.click()}
                                className="rounded-lg border border-border/40 bg-muted px-3 py-1 text-xs text-foreground hover:bg-foreground/10"
                            >
                                Replace Video File
                            </button>
                        </div>
                        {videoUrl.startsWith("data:video") ? (
                            <video src={videoUrl} controls className="mt-3 max-h-48 w-full rounded-lg bg-black" />
                        ) : (
                            <p className="mt-2 text-xs font-mono text-muted-foreground truncate">{videoUrl}</p>
                        )}
                    </div>
                ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                        <button
                            type="button"
                            onClick={() => videoInputRef.current?.click()}
                            className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 bg-muted/20 p-4 text-xs font-semibold text-foreground hover:border-blue-500/50 hover:bg-blue-500/[0.02] transition"
                        >
                            <Upload size={16} className="text-blue-400" />
                            Upload Video File (MP4)
                        </button>

                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                placeholder="Or paste YouTube / Vimeo link"
                                value={videoUrl}
                                onChange={(e) => onVideoUrlChange(e.target.value)}
                                className="w-full rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-blue-500 outline-none"
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* 3. Screenshot Gallery Upload */}
            <div className="rounded-2xl border border-border/40 bg-card/60 p-4 backdrop-blur-xl">
                <div className="mb-3">
                    <div>
                        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <Plus size={16} className="text-violet-400" />
                            Screenshot Gallery Upload ({images.length} images)
                        </h4>
                        <p className="text-xs text-muted-foreground">
                            Upload product screenshots to showcase platform indicators, backtest results, or settings.
                        </p>
                    </div>
                </div>

                {images.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {images.map((img, idx) => (
                            <div key={idx} className="group relative overflow-hidden rounded-xl border border-border/40 bg-black/20">
                                <img src={img} alt={`Screenshot ${idx + 1}`} className="h-24 w-full object-cover" />
                                <button
                                    type="button"
                                    onClick={() => removeScreenshot(idx)}
                                    className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-red-400 backdrop-blur-md transition hover:bg-red-500 hover:text-white"
                                >
                                    <X size={12} />
                                </button>
                                <div className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-mono text-white">
                                    #{idx + 1}
                                </div>
                            </div>
                        ))}
                        <button
                            type="button"
                            onClick={() => screenshotsInputRef.current?.click()}
                            className="flex h-24 flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/20 text-muted-foreground transition hover:border-violet-500/50 hover:bg-violet-500/[0.02] hover:text-foreground"
                        >
                            <Plus size={18} />
                            <span className="mt-1 text-[10px] font-medium">Add More</span>
                        </button>
                    </div>
                ) : (
                    <div
                        onClick={() => screenshotsInputRef.current?.click()}
                        className="group flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/20 p-6 text-center transition hover:border-violet-500/50 hover:bg-violet-500/[0.02]"
                    >
                        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-violet-500/30 bg-violet-500/10 text-violet-400 transition group-hover:scale-105">
                            <Upload size={18} />
                        </div>
                        <span className="text-xs font-semibold text-foreground">Click to upload Screenshot Files</span>
                        <span className="text-[11px] text-muted-foreground">Select multiple image files at once</span>
                    </div>
                )}
            </div>

            {/* Optional URL Toggle Fallback */}
            <div className="text-right">
                <button
                    type="button"
                    onClick={() => setShowUrlInputs(!showUrlInputs)}
                    className="text-[11px] text-muted-foreground underline transition hover:text-foreground"
                >
                    {showUrlInputs ? "Hide Direct URL Inputs" : "Need to paste direct image URL strings instead?"}
                </button>
            </div>

            {showUrlInputs && (
                <div className="rounded-xl border border-border/30 bg-muted/20 p-4 space-y-3">
                    <div>
                        <label className="text-[10px] uppercase font-bold text-muted-foreground">Direct Thumbnail URL</label>
                        <input
                            type="text"
                            value={imageUrl}
                            onChange={(e) => onImageUrlChange(e.target.value)}
                            placeholder="https://..."
                            className="mt-1 w-full rounded-lg border border-border/40 bg-muted px-3 py-2 text-xs text-foreground"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] uppercase font-bold text-muted-foreground">Direct Screenshot URLs (One per line)</label>
                        <textarea
                            value={images.join("\n")}
                            onChange={(e) => onImagesChange(e.target.value.split("\n").filter(Boolean))}
                            rows={2}
                            placeholder="https://...&#10;https://..."
                            className="mt-1 w-full rounded-lg border border-border/40 bg-muted px-3 py-2 text-xs text-foreground resize-none"
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
