export function validateIsraeliID(id: string): boolean {
  let strId = String(id).trim();
  if (strId.length > 9 || strId.length < 5 || isNaN(Number(strId))) return false;
  strId = strId.length < 9 ? ("00000000" + strId).slice(-9) : strId;

  let sum = 0;
  for (let i = 0; i < strId.length; i++) {
    let incNum = Number(strId[i]) * ((i % 2) + 1);
    sum += incNum > 9 ? incNum - 9 : incNum;
  }
  return sum % 10 === 0;
}
