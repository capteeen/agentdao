"use client";

import { liveBackend } from "./live";
import { simBackend } from "./sim";
import type { BossBackend } from "./types";

export const backend: BossBackend = process.env.NEXT_PUBLIC_BOSS_BACKEND === "live" ? liveBackend : simBackend;
