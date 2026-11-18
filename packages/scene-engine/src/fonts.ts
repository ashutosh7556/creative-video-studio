const FONTS = [
  { family: 'Inter', file: 'Inter.ttf' },
  { family: 'Noto Sans Devanagari', file: 'NotoSansDevanagari.ttf' },
];

/** Loads bundled fonts and fails loudly if they are not usable (never render with fallback glyphs). */
export async function loadFonts(): Promise<void> {
  for (const f of FONTS) {
    const face = new FontFace(f.family, `url(${import.meta.env.BASE_URL}${f.file})`, { weight: '100 900' });
    await face.load();
    document.fonts.add(face);
  }
  await document.fonts.ready;
  if (!document.fonts.check('600 40px "Noto Sans Devanagari"', 'क')) {
    throw new Error('Noto Sans Devanagari failed to load');
  }
  if (!document.fonts.check('600 40px "Inter"', 'A')) {
    throw new Error('Inter failed to load');
  }
}
