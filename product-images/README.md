# Bulk product images

This folder documents the website's bulk product-image workflow. Product images are stored in **Manus-managed object storage**, not in Git or a third-party host.

## Upload workflow

1. Open the admin product manager at `/admin/products` after signing in.
2. Choose **Bulk product images**.
3. Select multiple image files.
4. Name every file exactly after an existing product SKU, including the extension:
   - `HF-FER-1025.jpg`
   - `HF-INS-1000.webp`
   - `HF-DRA-1056.png`
5. The uploader places files in the Manus storage prefix `product-images/products/` and automatically updates the matching product's `primary_image_url` and `images` fields.

Images must be browser-supported image files and no larger than 10 MB each. Manus strips embedded metadata, preserves aspect ratio, resizes only when an image exceeds 2,400 px on its longest side, stamps the transparent PHN mark in the bottom-left corner, converts the result to quality-88 WebP, and puts a SHA-256 fingerprint segment in the stored filename. Files with an unknown SKU are skipped and reported; they are not attached to an unrelated product.

The fingerprint supports exact-file deduplication and asset traceability. It cannot prevent search engines from recognizing visually identical content across different websites; that requires genuinely distinct imagery and each site’s own canonical/licensing strategy.

The repository intentionally does not contain product image binaries. Durable image bytes live in Manus object storage and product metadata remains in the Manus-managed database.
