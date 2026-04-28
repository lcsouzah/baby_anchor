import { SCENARIOS } from "./config";
import { MarketSnapshot, ScenarioName } from "./types";

export function listScenarios(): ScenarioName[] {
  return [...SCENARIOS];
}

export function createPriceSeries(scenario: ScenarioName, steps: number, seed: number): MarketSnapshot[] {
  const rng = mulberry32(hashSeed(seed, scenario));
  const prices: MarketSnapshot[] = [];
  let price = 45;

  for (let step = 0; step < steps; step++) {
    const noise = (rng() - 0.5) * 1.8;
    const phase = step / Math.max(steps - 1, 1);

    switch (scenario) {
      case "bull_market":
        price += 0.12 + noise;
        break;
      case "crash_market":
        price -= 0.14 + Math.abs(noise * 0.6);
        break;
      case "sideways_chop":
        price += Math.sin(step / 6) * 0.8 + noise;
        break;
      case "bull_then_crash":
        price += phase < 0.45 ? 0.18 + noise : -0.26 + noise;
        break;
      case "crash_then_recovery":
        price += phase < 0.4 ? -0.23 + noise : 0.2 + noise;
        break;
      case "pump_and_dump":
        if (phase < 0.2) price += 0.08 + noise;
        else if (phase < 0.35) price += 0.85 + noise * 2.1;
        else price -= 0.42 + Math.abs(noise * 1.4);
        break;
      case "slow_bleed":
        price -= 0.05 + Math.abs(noise * 0.4);
        break;
      case "high_volatility":
        price += (rng() - 0.5) * 5.5 + Math.sin(step / 3) * 0.9;
        break;
      case "whale_shock":
        price += noise;
        if (step === Math.floor(steps * 0.35)) price *= 1.35;
        if (step === Math.floor(steps * 0.65)) price *= 0.68;
        break;
      case "random_walk":
        price += (rng() - 0.5) * 2.3;
        break;
    }

    price = clamp(price, 3, 200);
    prices.push({ step, price: round(price, 6) });
  }

  return prices;
}

function hashSeed(seed: number, scenario: string): number {
  let h = seed | 0;
  for (let i = 0; i < scenario.length; i++) h = Math.imul(h ^ scenario.charCodeAt(i), 0x45d9f3b);
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  return function rng() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits: number): number {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}
