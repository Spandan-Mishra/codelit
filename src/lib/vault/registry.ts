// Vault registry: generative scenarios. Each entry is a seeded
// story + test-suite generator (see src/lib/vault/*.ts).

import type { Scenario } from "../types";
import { rateLimitScenario } from "./rate_limit";
import { retryDelaysScenario } from "./retry_delays";
import { minRoomsScenario } from "./min_rooms";
import { topErrorScenario } from "./top_error";
import { allocateStockScenario } from "./allocate_stock";
import { validRowsScenario } from "./valid_rows";
import { overbookedSlotsScenario } from "./overbooked_slots";

export const VAULT_SCENARIOS: Scenario[] = [
  rateLimitScenario,
  retryDelaysScenario,
  minRoomsScenario,
  topErrorScenario,
  allocateStockScenario,
  validRowsScenario,
  overbookedSlotsScenario,
];

export function getVaultScenario(id: string): Scenario | undefined {
  return VAULT_SCENARIOS.find((s) => s.id === id);
}
