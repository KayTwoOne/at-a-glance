/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ConnectSrc, CspPolicies } from "@main/csp";

// Discord's Content-Security-Policy blocks renderer fetches to unknown hosts,
// which is why the weather card silently failed on desktop. These are the two
// endpoints weather.ts is allowed to call - connect-src only, nothing else.
// A FULL Discord restart (not Ctrl+R) is required for CSP changes to apply.
CspPolicies["api.open-meteo.com"] = ConnectSrc;
CspPolicies["geocoding-api.open-meteo.com"] = ConnectSrc;
