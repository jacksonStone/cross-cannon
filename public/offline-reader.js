const reader = document.querySelector("#reader");

void loadReader();

async function loadReader() {
  const passages = await loadScripturePassages();

  if (!passages.length) {
    reader.innerHTML = '<section class="error"><h1>Scripture is not available offline</h1><p>Open Cross Canon while connected once to prepare the offline reader.</p></section>';
    return;
  }

  renderPassage(passages, passageIdFromLocation() || passages[0].id);
}

async function loadScripturePassages() {
  const cacheNames = await caches.keys();

  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    const scriptureRequest = requests.find((request) => (
      new URL(request.url).pathname.startsWith("/scripture-cache/")
    ));

    if (!scriptureRequest) {
      continue;
    }

    const response = await cache.match(scriptureRequest);
    const payload = response ? await response.json() : null;

    if (payload && Array.isArray(payload.passages)) {
      return payload.passages;
    }
  }

  return [];
}

function passageIdFromLocation() {
  const prefix = "/reader/";

  return location.pathname.startsWith(prefix)
    ? decodeURIComponent(location.pathname.slice(prefix.length))
    : "";
}

function renderPassage(passages, passageId) {
  const index = passages.findIndex((passage) => passage.id === passageId);
  const selectedIndex = index >= 0 ? index : 0;
  const passage = passages[selectedIndex];
  const text = passage.text || passage.verses?.map((verse) => verse.text).join(" ") || "";

  document.title = `${passage.reference} | Cross Canon`;
  reader.innerHTML = "";
  const heading = document.createElement("h1");
  heading.textContent = passage.reference;
  const body = document.createElement("p");
  body.textContent = text;
  const navigation = document.createElement("nav");
  navigation.append(
    navigationButton("Previous", selectedIndex > 0 ? passages[selectedIndex - 1].id : ""),
    navigationButton("Next", selectedIndex < passages.length - 1 ? passages[selectedIndex + 1].id : "")
  );
  reader.append(heading, body, navigation);
}

function navigationButton(label, passageId) {
  const button = document.createElement("button");
  button.disabled = !passageId;
  button.textContent = label;
  button.addEventListener("click", () => {
    if (!passageId) {
      return;
    }

    history.pushState(null, "", `/reader/${encodeURIComponent(passageId)}`);
    void loadReader();
  });
  return button;
}
