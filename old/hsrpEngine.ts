/**
 * HSRPシミュレーションエンジン
 * Active/Standby選出、Priority、Preemptをシミュレート
 */

import { L3Switch, HsrpState, Device } from '@/stores/types';

// HSRP定数
const HSRP_DEFAULT_PRIORITY = 100;
const HSRP_DEFAULT_HELLO_TIMER = 3;
const HSRP_DEFAULT_HOLD_TIMER = 10;

// HSRPグループ作成
export function createHsrpGroup(group: number, virtualIp: string = ''): HsrpState {
    return {
        group,
        state: 'init',
        priority: HSRP_DEFAULT_PRIORITY,
        preempt: false,
        virtualIp,
        helloTimer: HSRP_DEFAULT_HELLO_TIMER,
        holdTimer: HSRP_DEFAULT_HOLD_TIMER,
    };
}

// インターフェースのHSRP仮想MACアドレス生成
export function getHsrpVirtualMac(group: number): string {
    const groupHex = group.toString(16).padStart(2, '0');
    return `00:00:0C:07:AC:${groupHex}`.toUpperCase();
}

// HSRP状態の優先度順序
const stateOrder: Record<HsrpState['state'], number> = {
    'init': 0,
    'learn': 1,
    'listen': 2,
    'speak': 3,
    'standby': 4,
    'active': 5,
};

// HSRP状態の表示名
export const hsrpStateNames: Record<HsrpState['state'], string> = {
    'init': 'Init',
    'learn': 'Learn',
    'listen': 'Listen',
    'speak': 'Speak',
    'standby': 'Standby',
    'active': 'Active',
};

// HSRP状態の色
export const hsrpStateColors: Record<HsrpState['state'], string> = {
    'init': 'text-gray-400',
    'learn': 'text-yellow-400',
    'listen': 'text-yellow-400',
    'speak': 'text-orange-400',
    'standby': 'text-blue-400',
    'active': 'text-green-400',
};

/**
 * 同一グループ内のHSRP選出を計算
 * @param devices すべてのL3スイッチ
 * @param group HSRPグループ番号
 * @returns 更新されたHSRP状態を持つデバイスリスト
 */
export function calculateHsrpElection(
    devices: Device[],
    group: number
): { deviceId: string; newState: HsrpState }[] {
    // L3スイッチのみ、指定グループを持つものをフィルタ
    const participants: { device: L3Switch; hsrp: HsrpState }[] = [];

    for (const device of devices) {
        if (device.type !== 'l3-switch') continue;
        const l3 = device as L3Switch;
        const hsrpGroup = l3.hsrpGroups.find(h => h.group === group);
        if (hsrpGroup && hsrpGroup.virtualIp) {
            participants.push({ device: l3, hsrp: hsrpGroup });
        }
    }

    if (participants.length === 0) {
        return [];
    }

    // Priority（高い方が勝ち）でソート、同一の場合はIPアドレス（ここではデバイスID）でソート
    participants.sort((a, b) => {
        if (b.hsrp.priority !== a.hsrp.priority) {
            return b.hsrp.priority - a.hsrp.priority;
        }
        // 同一Priorityの場合はデバイスIDで比較（実際はIPアドレス）
        return b.device.id.localeCompare(a.device.id);
    });

    const results: { deviceId: string; newState: HsrpState }[] = [];

    participants.forEach((p, index) => {
        let newState: HsrpState['state'];

        if (index === 0) {
            // 最高Priority -> Active
            newState = 'active';
        } else if (index === 1) {
            // 2番目 -> Standby
            newState = 'standby';
        } else {
            // それ以外 -> Listen
            newState = 'listen';
        }

        // Preemptチェック：Activeより高いPriorityでPreemptが有効なら奪取
        if (index > 0 && p.hsrp.preempt) {
            const currentActive = participants[0];
            if (p.hsrp.priority > currentActive.hsrp.priority) {
                // この場合、再計算が必要だが単純化のためここでは対応しない
            }
        }

        results.push({
            deviceId: p.device.id,
            newState: {
                ...p.hsrp,
                state: newState,
            },
        });
    });

    return results;
}

/**
 * HSRP設定をrunning-configに反映
 */
export function generateHsrpConfig(hsrpGroups: HsrpState[], interfaceName: string = 'Vlan1'): string[] {
    const config: string[] = [];

    for (const hsrp of hsrpGroups) {
        if (!hsrp.virtualIp) continue;

        config.push(`interface ${interfaceName}`);
        config.push(` standby ${hsrp.group} ip ${hsrp.virtualIp}`);
        config.push(` standby ${hsrp.group} priority ${hsrp.priority}`);
        if (hsrp.preempt) {
            config.push(` standby ${hsrp.group} preempt`);
        }
        if (hsrp.helloTimer !== HSRP_DEFAULT_HELLO_TIMER || hsrp.holdTimer !== HSRP_DEFAULT_HOLD_TIMER) {
            config.push(` standby ${hsrp.group} timers ${hsrp.helloTimer} ${hsrp.holdTimer}`);
        }
        config.push('!');
    }

    return config;
}

/**
 * show standby brief 出力フォーマット
 */
export function formatShowStandbyBrief(hsrpGroups: HsrpState[], interfaceName: string = 'Vlan1'): string[] {
    if (hsrpGroups.length === 0) {
        return ['% HSRP is not configured'];
    }

    const output: string[] = [
        '',
        '                     P indicates configured to preempt.',
        '                     |',
        'Interface   Grp  Pri P State   Active          Standby         Virtual IP',
    ];

    for (const hsrp of hsrpGroups) {
        const preemptFlag = hsrp.preempt ? 'P' : ' ';
        const stateStr = hsrpStateNames[hsrp.state].padEnd(7);
        const active = hsrp.state === 'active' ? 'local' : 'unknown';
        const standby = hsrp.state === 'standby' ? 'local' : 'unknown';

        output.push(
            `${interfaceName.padEnd(12)}${String(hsrp.group).padStart(3)}  ${String(hsrp.priority).padStart(3)} ${preemptFlag} ${stateStr} ${active.padEnd(15)} ${standby.padEnd(15)} ${hsrp.virtualIp}`
        );
    }

    return output;
}

/**
 * show standby 詳細出力フォーマット
 */
export function formatShowStandby(hsrpGroups: HsrpState[], hostname: string, interfaceName: string = 'Vlan1'): string[] {
    if (hsrpGroups.length === 0) {
        return ['% HSRP is not configured'];
    }

    const output: string[] = [];

    for (const hsrp of hsrpGroups) {
        output.push(`${interfaceName} - Group ${hsrp.group}`);
        output.push(`  State is ${hsrpStateNames[hsrp.state]}`);
        output.push(`  Virtual IP address is ${hsrp.virtualIp || 'not configured'}`);
        output.push(`  Active virtual MAC address is ${getHsrpVirtualMac(hsrp.group)}`);
        output.push(`  Local standby MAC address is ${getHsrpVirtualMac(hsrp.group)} (default)`);
        output.push(`  Hello time ${hsrp.helloTimer} sec, hold time ${hsrp.holdTimer} sec`);
        output.push(`  Preemption ${hsrp.preempt ? 'enabled' : 'disabled'}`);
        output.push(`  Priority ${hsrp.priority}${hsrp.priority === HSRP_DEFAULT_PRIORITY ? ' (default)' : ''}`);
        output.push(`  Group name is "hsrp-${interfaceName}-${hsrp.group}" (default)`);
        output.push('');
    }

    return output;
}
