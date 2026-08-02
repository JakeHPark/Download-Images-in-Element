(() => {
	const GLOBAL_KEY = "__downloadImagesInElement";
	const START_MESSAGE = "download-images-in-element:start";

	if (globalThis[GLOBAL_KEY]) return;

	const state = {
		active: false,
		target: null,
		overlay: null,
		panel: null,
		toast: null,
		cleanup: null,
	};

	globalThis[GLOBAL_KEY] = state;

	browser.runtime.onMessage.addListener((message) => {
		if (message?.type === START_MESSAGE) startPicker();
	});

	function startPicker() {
		if (state.active) return;
		state.active = true;

		const overlay = document.createElement("div");
		markUi(overlay);
		Object.assign(overlay.style, {
			position: "fixed",
			zIndex: "2147483646",
			pointerEvents: "none",
			border: "3px solid #ff4d00",
			background: "rgba(255,77,0,.10)",
			boxSizing: "border-box",
			display: "none",
		});

		const panel = document.createElement("div");
		markUi(panel);
		Object.assign(panel.style, {
			position: "fixed",
			zIndex: "2147483647",
			left: "50%",
			top: "12px",
			transform: "translateX(-50%)",
			display: "flex",
			alignItems: "center",
			gap: "10px",
			maxWidth: "calc(100vw - 24px)",
			padding: "10px 12px",
			borderRadius: "10px",
			color: "#fff",
			background: "rgba(24,24,24,.95)",
			boxShadow: "0 5px 24px rgba(0,0,0,.35)",
			font: "600 14px/1.25 system-ui,sans-serif",
		});

		const label = document.createElement("span");
		label.textContent = "Select the element whose images you want.";

		const cancel = document.createElement("button");
		markUi(cancel);
		cancel.type = "button";
		cancel.textContent = "Cancel";
		Object.assign(cancel.style, {
			appearance: "none",
			border: "1px solid rgba(255,255,255,.45)",
			borderRadius: "7px",
			padding: "6px 9px",
			color: "#fff",
			background: "transparent",
			font: "inherit",
			cursor: "pointer",
			pointerEvents: "auto",
		});

		panel.append(label, cancel);
		document.documentElement.append(overlay, panel);
		state.overlay = overlay;
		state.panel = panel;

		const onPointerMove = (event) => {
			const candidate = firstSelectable(event.composedPath());
			if (!candidate) return;
			state.target = candidate;
			positionOverlay(candidate);
		};

		const onClick = (event) => {
			if (event.composedPath().some(isUi)) return;
			const selected = firstSelectable(event.composedPath()) || state.target;
			if (!selected) return;

			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			stopPicker();
			void packageImages(selected);
		};

		const onKeyDown = (event) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			stopPicker();
		};

		const onViewportChange = () => {
			if (state.target) positionOverlay(state.target);
		};

		cancel.addEventListener("click", stopPicker, { once: true });
		window.addEventListener("pointermove", onPointerMove, true);
		window.addEventListener("click", onClick, true);
		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("scroll", onViewportChange, true);
		window.addEventListener("resize", onViewportChange, true);

		state.cleanup = () => {
			window.removeEventListener("pointermove", onPointerMove, true);
			window.removeEventListener("click", onClick, true);
			window.removeEventListener("keydown", onKeyDown, true);
			window.removeEventListener("scroll", onViewportChange, true);
			window.removeEventListener("resize", onViewportChange, true);
			overlay.remove();
			panel.remove();
		};
	}

	function stopPicker() {
		if (!state.active) return;
		state.cleanup?.();
		state.active = false;
		state.target = null;
		state.overlay = null;
		state.panel = null;
		state.cleanup = null;
	}

	function markUi(element) {
		element.dataset.downloadImagesInElementUi = "true";
	}

	function isUi(value) {
		return (
			value instanceof Element &&
			value.dataset.downloadImagesInElementUi === "true"
		);
	}

	function firstSelectable(path) {
		for (const value of path) {
			if (value instanceof Element && !isUi(value)) return value;
		}
		return null;
	}

	function positionOverlay(element) {
		const rect = element.getBoundingClientRect();
		const left = Math.max(0, rect.left);
		const top = Math.max(0, rect.top);
		const right = Math.min(window.innerWidth, rect.right);
		const bottom = Math.min(window.innerHeight, rect.bottom);

		Object.assign(state.overlay.style, {
			display: "block",
			left: `${left}px`,
			top: `${top}px`,
			width: `${Math.max(0, right - left)}px`,
			height: `${Math.max(0, bottom - top)}px`,
		});
	}

	const EXTENSION_FETCH = globalThis.fetch.bind(globalThis);

	const PAGE_FETCH =
		typeof content !== "undefined" && typeof content.fetch === "function"
			? content.fetch.bind(content)
			: null;

	const FETCH_OPTIONS = Object.freeze({
		credentials: "include",
		redirect: "follow",
		cache: "default",
	});

	function isProbablyAuthFailure(response, contentType) {
		return (
			response.status === 401 ||
			response.status === 403 ||
			response.status === 407 ||
			response.status === 429 ||
			contentType === "text/html" ||
			/\/cdn-cgi\/(?:access|challenge-platform)\//i.test(response.url || "")
		);
	}

	async function fetchImage(url) {
		const target = new URL(url);
		const isHttp = target.protocol === "http:" || target.protocol === "https:";
		const sameOrigin = target.origin === location.origin;

		/*
		 * Same-origin authenticated resources should use the page request
		 * context first. Cross-origin resources should use the extension's
		 * elevated host permissions first, because page fetch is CORS-bound.
		 */
		const attempts = [];

		if (isHttp && sameOrigin && PAGE_FETCH) {
			attempts.push(["page", PAGE_FETCH]);
		}

		attempts.push(["extension", EXTENSION_FETCH]);

		if (isHttp && !sameOrigin && PAGE_FETCH) {
			attempts.push(["page", PAGE_FETCH]);
		}

		let lastError = new Error("No request method available");

		for (const [mode, fetchFn] of attempts) {
			let response;

			try {
				response = await fetchFn(url, FETCH_OPTIONS);
			} catch (error) {
				lastError = new Error(
					`[${mode}] ${error instanceof Error ? error.message : String(error)}`,
				);
				continue;
			}

			const contentType = normalizeMimeType(
				response.headers.get("content-type"),
			);

			if (response.ok && contentType !== "text/html") {
				return {
					response,
					contentType,
					requestMode: mode,
				};
			}

			lastError = new Error(
				[
					`[${mode}] HTTP ${response.status}`,
					contentType || "unknown content type",
					response.redirected ? "redirected" : "",
					`final URL: ${response.url || url}`,
				]
					.filter(Boolean)
					.join("; "),
			);

			/*
			 * Do not retry an ordinary 404 through a different context.
			 * Retry only where authentication/challenge semantics may matter.
			 */
			if (!isProbablyAuthFailure(response, contentType)) {
				break;
			}
		}

		throw lastError;
	}

	async function packageImages(root) {
		const toast = showToast("Scanning element…");

		try {
			const sources = collectImageSources(root);
			if (sources.length === 0) {
				toast.set("No image sources found in that element.");
				toast.dismissAfter(2500);
				return;
			}

			toast.set(
				`Found ${sources.length} image${sources.length === 1 ? "" : "s"}. Fetching…`,
			);

			let completed = 0;
			const fetched = await mapPool(sources, 4, async (source, index) => {
				try {
					const { response, contentType } = await fetchImage(source.url);

					if (!response.ok) throw new Error(`HTTP ${response.status}`);

					if (contentType === "text/html") {
						throw new Error(
							"Server returned HTML, probably a login or error page",
						);
					}

					return {
						ok: true,
						index,
						source,
						responseUrl: response.url || source.url,
						contentType,
						contentDisposition: response.headers.get("content-disposition"),
						bytes: new Uint8Array(await response.arrayBuffer()),
					};
				} catch (error) {
					return {
						ok: false,
						index,
						source,
						error: error instanceof Error ? error.message : String(error),
					};
				} finally {
					completed += 1;
					toast.set(`Fetching images… ${completed}/${sources.length}`);
				}
			});

			const entries = [];
			const failures = [];
			const usedNames = new Set();

			for (const result of fetched) {
				if (!result.ok) {
					failures.push(`${result.source.url}\n  ${result.error}`);
					continue;
				}

				entries.push({
					name: uniqueFilename(chooseFilename(result), usedNames),
					bytes: result.bytes,
					mtime: new Date(),
				});
			}

			if (failures.length > 0) {
				entries.push({
					name: "_failures.txt",
					bytes: new TextEncoder().encode(
						["Some image requests failed.", "", ...failures, ""].join("\n"),
					),
					mtime: new Date(),
				});
			}

			if (entries.length === 0) {
				toast.set("Every image request failed.");
				toast.dismissAfter(3500);
				return;
			}

			toast.set("Building ZIP…");
			const zipBlob = ImageZipStore.buildStoredZip(entries);
			const archiveName = buildArchiveName(document.title);

			toast.set("Starting download…");
			triggerBlobDownload(zipBlob, archiveName);

			const successCount = fetched.filter((item) => item.ok).length;
			toast.set(
				`Handed ${successCount} image${successCount === 1 ? "" : "s"} to Firefox as a ZIP.`,
			);
			toast.dismissAfter(3000);
		} catch (error) {
			console.error("Image ZIP failed:", error);
			toast.set(
				`Image ZIP failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			toast.dismissAfter(5000);
		}
	}

	function collectImageSources(root) {
		const byUrl = new Map();
		let visited = 0;
		const MAX_ELEMENTS = 15000;

		const add = (rawUrl, hint = "") => {
			const absoluteUrl = absolutizeUrl(rawUrl);
			if (!absoluteUrl) {
				return;
			}

			const url = preferOriginalImageUrl(absoluteUrl);
			if (byUrl.has(url)) {
				return;
			}

			byUrl.set(url, {
				url,
				hint: sanitizeNamePart(hint),
			});
		};

		for (const element of walkElements(root)) {
			visited += 1;
			if (visited > MAX_ELEMENTS) break;

			const tag = element.localName;

			if (tag === "img") {
				add(element.currentSrc, element.alt);
				add(element.getAttribute("src"), element.alt);
				for (const attribute of [
					"data-src",
					"data-original",
					"data-lazy-src",
					"data-url",
				]) {
					add(element.getAttribute(attribute), element.alt);
				}
				add(
					bestCandidateFromSrcset(element.getAttribute("srcset")),
					element.alt,
				);
				add(
					bestCandidateFromSrcset(element.getAttribute("data-srcset")),
					element.alt,
				);
			}

			if (tag === "input" && element.type === "image") {
				add(element.src, element.alt);
			}

			if (tag === "video") {
				add(element.poster, "poster");
			}

			if (tag === "image") {
				add(
					element.getAttribute("href") ||
						element.getAttributeNS("http://www.w3.org/1999/xlink", "href"),
					element.getAttribute("aria-label") || "svg-image",
				);
			}

			if (tag === "object" && /^image\//i.test(element.type || "")) {
				add(element.data, "object-image");
			}

			if (tag === "embed" && /^image\//i.test(element.type || "")) {
				add(element.src, "embedded-image");
			}

			if (tag === "canvas") {
				try {
					add(element.toDataURL("image/png"), "canvas");
				} catch {
					//Cross-origin-tainted canvases cannot be exported.
				}
			}

			addCssImages(getComputedStyle(element), add, element);
			addPseudoImages(element, "::before", add);
			addPseudoImages(element, "::after", add);
		}

		return [...byUrl.values()];
	}

	function* walkElements(root) {
		if (!(root instanceof Element)) return;
		yield root;
		for (const child of root.children) yield* walkElements(child);
		if (root.shadowRoot) {
			for (const child of root.shadowRoot.children) yield* walkElements(child);
		}
	}

	function addPseudoImages(element, pseudo, add) {
		try {
			const style = getComputedStyle(element, pseudo);
			if (style.content !== "none" || style.backgroundImage !== "none") {
				addCssImages(style, add, element);
			}
		} catch {
			//Some browser-internal elements reject pseudo-style reads.
		}
	}

	function addCssImages(style, add, element) {
		const hint =
			element.getAttribute?.("aria-label") ||
			element.id ||
			element.localName ||
			"background";

		for (const property of [
			"backgroundImage",
			"borderImageSource",
			"listStyleImage",
			"maskImage",
			"webkitMaskImage",
			"content",
		]) {
			for (const url of extractCssUrls(style[property])) add(url, hint);
		}
	}

	function extractCssUrls(value) {
		if (!value || value === "none") {
			return [];
		}
		const urls = [];
		const pattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g;
		let match;
		while ((match = pattern.exec(value))) {
			const url = (match[1] || match[2] || match[3] || "").trim();
			if (url) {
				urls.push(url);
			}
		}
		return urls;
	}

	function bestCandidateFromSrcset(value) {
		if (!value || value.startsWith("data:")) {
			return "";
		}
		const candidates = value
			.split(",")
			.map((part) => part.trim())
			.filter(Boolean)
			.map((part) => {
				const [url, descriptor = "1x"] = part.split(/\s+/, 2);
				const numeric = Number.parseFloat(descriptor) || 1;
				return { url, score: numeric * (descriptor.endsWith("w") ? 1000 : 1) };
			})
			.sort((a, b) => b.score - a.score);
		return candidates[0]?.url || "";
	}

	function absolutizeUrl(rawUrl) {
		if (!rawUrl) {
			return "";
		}
		const value = String(rawUrl).trim();
		if (!value || value.startsWith("javascript:")) {
			return "";
		}
		try {
			return new URL(value, document.baseURI).href;
		} catch {
			return "";
		}
	}

	function preferOriginalImageUrl(rawUrl) {
		try {
			const url = new URL(rawUrl);

			if (url.hostname !== "upload.wikimedia.org") {
				return url.href;
			}

			/*
			 * Wikimedia thumbnail:
			 *
			 * /wikipedia/commons/thumb/d/d9/File.jpg/250px-File.jpg
			 *
			 * Original:
			 *
			 * /wikipedia/commons/d/d9/File.jpg
			 */
			const match = url.pathname.match(/^(.*)\/thumb\/(.+)\/[^/]+$/);

			if (!match) {
				return url.href;
			}

			url.pathname = `${match[1]}/${match[2]}`;
			url.search = "";
			url.hash = "";

			return url.href;
		} catch {
			return rawUrl;
		}
	}

	async function mapPool(values, concurrency, worker) {
		const results = new Array(values.length);
		let nextIndex = 0;

		async function runWorker() {
			while (true) {
				const index = nextIndex;
				nextIndex += 1;
				if (index >= values.length) return;
				results[index] = await worker(values[index], index);
			}
		}

		await Promise.all(
			Array.from({ length: Math.min(concurrency, values.length) }, runWorker),
		);
		return results;
	}

	function chooseFilename(result) {
		const fromHeader = filenameFromContentDisposition(
			result.contentDisposition,
		);
		if (fromHeader) {
			return ensureExtension(fromHeader, result.contentType);
		}
		const fromUrl = filenameFromUrl(result.responseUrl);
		if (fromUrl) {
			return ensureExtension(fromUrl, result.contentType);
		}
		return ensureExtension(
			result.source.hint || `image-${result.index + 1}`,
			result.contentType,
		);
	}

	function filenameFromContentDisposition(value) {
		if (!value) {
			return "";
		}

		const encoded = value.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
		if (encoded) {
			try {
				return sanitizeFilename(decodeURIComponent(encoded[1].trim()));
			} catch {
				return sanitizeFilename(encoded[1].trim());
			}
		}

		const plain = value.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
		return sanitizeFilename((plain?.[1] || plain?.[2] || "").trim());
	}

	function filenameFromUrl(value) {
		try {
			const last =
				new URL(value).pathname.split("/").filter(Boolean).pop() || "";
			return sanitizeFilename(decodeURIComponent(last));
		} catch {
			return "";
		}
	}

	function ensureExtension(filename, contentType) {
		const clean = sanitizeFilename(filename) || "image";
		if (/\.[a-z0-9]{1,8}$/i.test(clean)) return clean;
		const extension = extensionForMime(contentType);
		return extension ? `${clean}.${extension}` : clean;
	}

	function extensionForMime(contentType) {
		return (
			{
				"image/avif": "avif",
				"image/bmp": "bmp",
				"image/gif": "gif",
				"image/heic": "heic",
				"image/heif": "heif",
				"image/jpeg": "jpg",
				"image/jxl": "jxl",
				"image/png": "png",
				"image/svg+xml": "svg",
				"image/tiff": "tif",
				"image/webp": "webp",
				"image/x-icon": "ico",
			}[contentType] || ""
		);
	}

	function uniqueFilename(filename, used) {
		const clean = sanitizeFilename(filename) || "image";
		const dot = clean.lastIndexOf(".");
		const stem = dot > 0 ? clean.slice(0, dot) : clean;
		const extension = dot > 0 ? clean.slice(dot) : "";
		let candidate = clean;
		let suffix = 2;

		while (used.has(candidate.toLowerCase())) {
			candidate = `${stem}-${suffix}${extension}`;
			suffix += 1;
		}

		used.add(candidate.toLowerCase());
		return candidate;
	}

	function sanitizeFilename(value) {
		return String(value || "")
			.replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_")
			.replace(/\s+/g, " ")
			.trim()
			.replace(/^\.+|\.+$/g, "")
			.slice(0, 180);
	}

	function sanitizeNamePart(value) {
		return sanitizeFilename(value)
			.replace(/\.[a-z0-9]{1,8}$/i, "")
			.slice(0, 80);
	}

	function normalizeMimeType(value) {
		return String(value || "")
			.split(";", 1)[0]
			.trim()
			.toLowerCase();
	}

	function triggerBlobDownload(blob, filename) {
		//Keep the blob URL in the same document that clicks it. Passing the Blob
		//through runtime messaging and then awaiting downloads.download() can hang
		//on Firefox for Android. A same-document <a download> is the simpler and
		//more reliable path on both desktop and Android.
		const objectUrl = URL.createObjectURL(blob);
		const anchor = document.createElement("a");

		anchor.href = objectUrl;
		anchor.download = sanitizeFilename(filename) || "images.zip";
		anchor.dataset.downloadImagesInElementUi = "true";
		anchor.style.display = "none";

		document.documentElement.append(anchor);
		anchor.click();

		//Do not revoke immediately: Firefox may begin consuming the blob URL
		//asynchronously, particularly on Android.
		setTimeout(
			() => {
				anchor.remove();
				URL.revokeObjectURL(objectUrl);
			},
			5 * 60 * 1000,
		);
	}

	function buildArchiveName(title) {
		const base = sanitizeFilename(title) || "images";
		const now = new Date();
		const stamp =
			`${now.getFullYear()}` +
			`${String(now.getMonth() + 1).padStart(2, "0")}` +
			`${String(now.getDate()).padStart(2, "0")}-` +
			`${String(now.getHours()).padStart(2, "0")}` +
			`${String(now.getMinutes()).padStart(2, "0")}` +
			`${String(now.getSeconds()).padStart(2, "0")}`;
		return `${base.slice(0, 120)}-${stamp}.zip`;
	}

	function showToast(initialText) {
		state.toast?.remove();

		const element = document.createElement("div");
		markUi(element);
		element.textContent = initialText;
		Object.assign(element.style, {
			position: "fixed",
			zIndex: "2147483647",
			left: "50%",
			bottom: "18px",
			transform: "translateX(-50%)",
			maxWidth: "calc(100vw - 28px)",
			padding: "10px 13px",
			borderRadius: "9px",
			color: "#fff",
			background: "rgba(24,24,24,.95)",
			boxShadow: "0 5px 24px rgba(0,0,0,.35)",
			font: "600 14px/1.3 system-ui,sans-serif",
			textAlign: "center",
			pointerEvents: "none",
		});

		document.documentElement.append(element);
		state.toast = element;

		const api = {
			set(text) {
				if (element.isConnected) {
					element.textContent = text;
				}
			},
			remove() {
				element.remove();
				if (state.toast === element) {
					state.toast = null;
				}
			},
			dismissAfter(ms) {
				setTimeout(() => api.remove(), ms);
			},
		};

		return api;
	}
})();
