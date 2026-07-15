/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** "Bandits' Oven" -> "BO" - the placeholder shown when a guild has no icon,
 *  mirroring how Discord's own server rail abbreviates iconless guilds */
export function guildAcronym(name: string): string {
    return name.split(/\s+/).map(word => word[0]).join("").slice(0, 3);
}
