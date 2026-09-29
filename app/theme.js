(() => {
  let theme = 'dark';
  try {
    const saved = localStorage.getItem('trackmark-theme');
    if (saved === 'dark' || saved === 'light') theme = saved;
  } catch {
    /* Theme preference is optional. */
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
