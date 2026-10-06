// Where Tesseract's files are served from. vite.config.js copies them there;
// the version in the path keeps an old cached copy from being used after an
// upgrade.
export const OCR_VERSION = "7.0.0";
export const OCR_ASSETS = `/ocr/${OCR_VERSION}/`;
