const START_MESSAGE = "download-images-in-element:start";
const MENU_ID = "download-images-in-element";

async function startPicker(tab) {
	if (!tab || typeof tab.id !== "number") {
		return;
	}

	try {
		//Both scripts are idempotent, so reinjection is harmless.
		await browser.tabs.executeScript(tab.id, {
			file: "lib/zip-store.js",
			runAt: "document_idle",
		});

		await browser.tabs.executeScript(tab.id, {
			file: "content/picker.js",
			runAt: "document_idle",
		});

		await browser.tabs.sendMessage(tab.id, {
			type: START_MESSAGE,
		});
	} catch (error) {
		console.error("Could not start element picker:", error);
		flashBadge("!");
	}
}

//Toolbar/add-ons-menu button.
browser.browserAction.onClicked.addListener(startPicker);

//Firefox desktop only: Android currently has no menus API.
if (browser.contextMenus) {
	browser.runtime.onInstalled.addListener(() => {
		browser.contextMenus.create({
			id: MENU_ID,
			title: "Download Images in Element",
			contexts: ["all"],
		});
	});

	browser.contextMenus.onClicked.addListener((info, tab) => {
		if (info.menuItemId === MENU_ID) {
			void startPicker(tab);
		}
	});
}

function flashBadge(text) {
	browser.browserAction.setBadgeText({ text }).catch(() => {});

	setTimeout(() => {
		browser.browserAction.setBadgeText({ text: "" }).catch(() => {});
	}, 2500);
}
