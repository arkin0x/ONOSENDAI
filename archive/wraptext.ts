export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  x: number,
  y: number,
  lineHeight: number
) {
  const xOffset = x;
  let yOffset = y;
  const lines = text.split('\n');
  const fittingLines: [string, number, number][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (ctx.measureText(lines[i]).width <= maxWidth) {
      fittingLines.push([lines[i], xOffset, yOffset]);
      yOffset += lineHeight;
    } else {
      let tmp = lines[i];
      while (ctx.measureText(tmp).width > maxWidth) {
        tmp = tmp.slice(0, tmp.length - 1);
      }
      if (tmp.length >= 1) {
        const regex = new RegExp(`.{1,${tmp.length}}`, 'g');
        const thisLineSplitted = lines[i].match(regex);
        for (let j = 0; j < thisLineSplitted!.length; j++) {
          fittingLines.push([thisLineSplitted![j], xOffset, yOffset]);
          yOffset += lineHeight;
        }
      }
    }
  }
  return fittingLines;
}