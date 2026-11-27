if (sessionStorage.getItem("red-house-unlocked") !== "true") {
  window.location.replace(new URL("./index.html", import.meta.url).href);
}
