(() => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const frames = [...document.querySelectorAll(".cin-frame")];
  if (!frames.length) return;
  let i = 0;
  setInterval(() => {
    i = (i + 1) % frames.length;
    frames.forEach((f, j) => f.classList.toggle("is-on", j === i));
  }, 2800);
})();
