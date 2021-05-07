/** push a value onto dictionary of lists, at a given key;
 * handling the case where the list is not yet initialised
 *
 * @ThisWouldBeOneLineIn(language="python", toWit="defaultdict(list).push")
 */
export function defaultDictPush<V>(
  dict: { [key: string]: V[] },
  key: string,
  value: V,
): void {
  const existing = dict[key];
  if (existing) {
    existing.push(value);
  } else {
    dict[key] = [value];
  }
}
