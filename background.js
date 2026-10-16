"use strict";

// MV3 的工具栏入口。打开本地页面无需读取任何招聘网页或浏览历史。
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("index.html") }).catch(console.error);
});
