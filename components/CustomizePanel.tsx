/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { RenderModalProps } from "@vencord/discord-types";
import { Modal, showToast, Toasts } from "@webpack/common";

import {
    DEFAULT_APPEARANCE,
    GLANCE_BG_MODES,
    GLANCE_MATERIALS,
    GlanceBackgroundMode,
    GlanceMaterial,
    setAppearance,
    useGlanceConfig
} from "../data";
import { GLANCE_PRESETS } from "../presets";
import { ArrowIcon } from "./icons";
import { openGlanceModal, useGlanceModalGuard } from "./modals";

const MATERIAL_LABELS: Record<GlanceMaterial, string> = {
    classic: "Classic",
    acrylic: "Acrylic",
    glass: "Glass"
};

const BG_MODE_LABELS: Record<GlanceBackgroundMode, string> = {
    theme: "Match theme",
    solid: "Solid",
    gradient: "Gradient"
};

function CustomizeModal({ modalProps }: { modalProps: RenderModalProps; }) {
    useGlanceModalGuard();
    const { appearance } = useGlanceConfig();

    return (
        <Modal
            {...modalProps}
            size="sm"
            title="Customization"
            subtitle="Changes preview live on the page behind"
            actions={[
                {
                    text: "Reset to defaults",
                    variant: "secondary",
                    onClick: () => setAppearance({ ...DEFAULT_APPEARANCE })
                },
                {
                    text: "Done",
                    variant: "primary",
                    onClick: modalProps.onClose
                }
            ]}
        >
            <div className="vc-glance-customize-body">
                <div className="vc-glance-customize-section">
                    <span className="vc-glance-customize-label">Presets</span>
                    <div className="vc-glance-preset-row">
                        {GLANCE_PRESETS.map(preset => (
                            <button
                                key={preset.id}
                                className="vc-glance-preset-chip"
                                title={preset.label}
                                onClick={() => {
                                    setAppearance(preset.apply);
                                    showToast(`Applied ${preset.label}`, Toasts.Type.SUCCESS);
                                }}
                            >
                                <span
                                    className="vc-glance-preset-swatch"
                                    style={{ background: `linear-gradient(135deg, ${preset.swatch[0]}, ${preset.swatch[1]})` }}
                                />
                                <span className="vc-glance-preset-name">{preset.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="vc-glance-customize-section">
                    <span className="vc-glance-customize-label">Background</span>
                    <div className="vc-glance-segmented">
                        {GLANCE_BG_MODES.map(mode => (
                            <button
                                key={mode}
                                className={"vc-glance-segment" + (appearance.backgroundMode === mode ? " vc-glance-segment-active" : "")}
                                onClick={() => setAppearance({ backgroundMode: mode })}
                            >
                                {BG_MODE_LABELS[mode]}
                            </button>
                        ))}
                    </div>
                    {appearance.backgroundMode === "theme"
                        ? <span className="vc-glance-hint">Follows your Discord/Nitro theme. Switch to Solid or Gradient to override a busy theme.</span>
                        : appearance.backgroundMode === "solid"
                            ? (
                                <div className="vc-glance-color-row vc-glance-bg-color-row">
                                    <input
                                        type="color"
                                        className="vc-glance-color-input"
                                        value={appearance.backgroundColor}
                                        onChange={e => setAppearance({ backgroundColor: e.target.value })}
                                        aria-label="Background colour"
                                    />
                                    <span className="vc-glance-color-hex">{appearance.backgroundColor}</span>
                                    <span className="vc-glance-hint">Overrides your theme with this colour.</span>
                                </div>
                            )
                            : <span className="vc-glance-hint">Uses your Primary → Accent colours and Direction below as an opaque gradient.</span>
                    }
                </div>

                {appearance.backgroundMode !== "theme" && (
                    <div className="vc-glance-customize-section">
                        <div className="vc-glance-customize-slider-head">
                            <span className="vc-glance-customize-label">Surface opacity</span>
                            <span className="vc-glance-customize-value">{appearance.surfaceOpacity}%</span>
                        </div>
                        <input
                            type="range"
                            className="vc-glance-slider"
                            min={40} max={100} step={1}
                            value={appearance.surfaceOpacity}
                            onChange={e => setAppearance({ surfaceOpacity: Number(e.target.value) })}
                            aria-label="Surface opacity"
                        />
                    </div>
                )}

                <div className="vc-glance-customize-section">
                    <span className="vc-glance-customize-label">Material</span>
                    <div className="vc-glance-segmented">
                        {GLANCE_MATERIALS.map(material => (
                            <button
                                key={material}
                                className={"vc-glance-segment" + (appearance.material === material ? " vc-glance-segment-active" : "")}
                                onClick={() => setAppearance({ material })}
                            >
                                {MATERIAL_LABELS[material]}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="vc-glance-customize-section">
                    <div className="vc-glance-customize-colors">
                        <div className="vc-glance-customize-color">
                            <span className="vc-glance-customize-label">Primary</span>
                            <div className="vc-glance-color-row">
                                <input
                                    type="color"
                                    className="vc-glance-color-input"
                                    value={appearance.primary}
                                    onChange={e => setAppearance({ primary: e.target.value })}
                                    aria-label="Primary colour"
                                />
                                <span className="vc-glance-color-hex">{appearance.primary}</span>
                            </div>
                        </div>
                        <div className="vc-glance-customize-color">
                            <span className="vc-glance-customize-label">Accent</span>
                            <div className="vc-glance-color-row">
                                <input
                                    type="color"
                                    className="vc-glance-color-input"
                                    value={appearance.accent}
                                    onChange={e => setAppearance({ accent: e.target.value })}
                                    aria-label="Accent colour"
                                />
                                <span className="vc-glance-color-hex">{appearance.accent}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="vc-glance-customize-section">
                    <span className="vc-glance-customize-label">Name colour</span>
                    <div className="vc-glance-segmented">
                        <button
                            className={"vc-glance-segment" + (appearance.nameColor === null ? " vc-glance-segment-active" : "")}
                            onClick={() => setAppearance({ nameColor: null })}
                        >
                            Match accent
                        </button>
                        <button
                            className={"vc-glance-segment" + (appearance.nameColor !== null ? " vc-glance-segment-active" : "")}
                            onClick={() => setAppearance({ nameColor: appearance.nameColor ?? "#ffffff" })}
                        >
                            Custom
                        </button>
                    </div>
                    {appearance.nameColor !== null
                        ? (
                            <div className="vc-glance-color-row">
                                <input
                                    type="color"
                                    className="vc-glance-color-input"
                                    value={appearance.nameColor}
                                    onChange={e => setAppearance({ nameColor: e.target.value })}
                                    aria-label="Greeting name colour"
                                />
                                <span className="vc-glance-color-hex">{appearance.nameColor}</span>
                                <span className="vc-glance-hint">Your name in the greeting uses this colour.</span>
                            </div>
                        )
                        : <span className="vc-glance-hint">Your name in the greeting follows the Primary → Accent gradient.</span>
                    }
                </div>

                <div className="vc-glance-customize-section">
                    <div className="vc-glance-customize-slider-head">
                        <span className="vc-glance-customize-label">Colour intensity</span>
                        <span className="vc-glance-customize-value">{appearance.intensity}%</span>
                    </div>
                    <input
                        type="range"
                        className="vc-glance-slider"
                        min={0} max={100} step={1}
                        value={appearance.intensity}
                        onChange={e => setAppearance({ intensity: Number(e.target.value) })}
                        aria-label="Colour intensity"
                    />
                </div>

                <div className="vc-glance-customize-section">
                    <div className="vc-glance-customize-slider-head">
                        <span className="vc-glance-customize-label">Direction</span>
                        <span className="vc-glance-customize-value">
                            <span
                                className="vc-glance-angle-arrow"
                                style={{ transform: `rotate(${appearance.angle}deg)` }}
                                aria-hidden
                            >
                                <ArrowIcon size={13} direction="up" />
                            </span>
                            {appearance.angle}°
                        </span>
                    </div>
                    <input
                        type="range"
                        className="vc-glance-slider"
                        min={0} max={360} step={1}
                        value={appearance.angle}
                        onChange={e => setAppearance({ angle: Number(e.target.value) })}
                        aria-label="Shine direction"
                    />
                </div>
            </div>
        </Modal>
    );
}

/** Opens the customization modal; every control commits immediately (live preview) */
export function openCustomizePanel() {
    openGlanceModal(modalProps => <CustomizeModal modalProps={modalProps} />);
}
