// Shared by browser layout diagnostics. Phaser Text.getBounds() includes its
// parent Container transform; descendants inherit visibility and mask scope.
export function visibleTextBounds(root) {
  const found = [];
  const visit = (object, visible, masked) => {
    if (!object || !visible || object.visible === false || (object.alpha ?? 1) <= 0.01) return;
    const insideMask = masked || Boolean(object.mask);
    if (typeof object.text === 'string' && typeof object.getBounds === 'function') {
      found.push({ object, bounds: object.getBounds(), masked: insideMask });
    }
    const children = Array.isArray(object.list) ? object.list : object.children?.list;
    if (Array.isArray(children)) children.forEach((child) => visit(child, true, insideMask));
  };
  visit(root, true, false);
  return found;
}
