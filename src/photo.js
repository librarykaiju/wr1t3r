// A photo from the camera (on a phone) or a picture file, or null when
// cancelled.
export const choosePhoto = () => chooseFile("image/*", true);

// A file of the accept types, or null when cancelled; camera: a phone opens
// the camera.
export function chooseFile(accept, camera = false) {
	return new Promise((resolve) => {
		// In the page while it's open: Safari ignores a click on a detached
		// input, and a phone can let one go while the camera is up.
		const input = Object.assign(document.createElement("input"), { type: "file", accept, hidden: true });
		if (camera) input.setAttribute("capture", "environment");
		document.body.append(input);
		input.addEventListener("change", () => { resolve(input.files[0] || null); input.remove(); }, { once: true });
		input.addEventListener("cancel", () => { resolve(null); input.remove(); }, { once: true });
		window.addEventListener("focus", () => setTimeout(() => { if (!input.files?.length) input.remove(); }, 1000), { once: true });
		input.click();
	});
}

// A phone photo made small enough to keep in the vault: its longer side at
// most max pixels, as a JPEG. The file as it is when it's already small or
// can't be drawn.
export async function shrinkPhoto(file, max = 1200) {
	try {
		const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
		const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
		if (scale === 1 && file.size < 500 * 1024) { bmp.close?.(); return file; }
		const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
		canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
		bmp.close?.();
		const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85));
		return blob ? new File([blob], "photo.jpg", { type: "image/jpeg" }) : file;
	} catch {
		return file;
	}
}
