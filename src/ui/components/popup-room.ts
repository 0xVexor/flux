/** True inside the toolbar popup window, which cannot draw anything outside itself. */
export const inPopup = () => document.documentElement.classList.contains('capture-mode');
