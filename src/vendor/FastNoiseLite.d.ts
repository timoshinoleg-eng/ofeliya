export default class FastNoiseLite {
  static NoiseType: { readonly Cellular: 'Cellular' };
  static CellularReturnType: { readonly Distance2Sub: 'Distance2Sub' };
  constructor(seed?: number);
  SetNoiseType(type: 'Cellular'): void;
  SetCellularReturnType(type: 'Distance2Sub'): void;
  SetFrequency(frequency: number): void;
  GetNoise(x: number, y: number): number;
}
