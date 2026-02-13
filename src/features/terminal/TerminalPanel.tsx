'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as TerminalIcon, Maximize2, Minimize2, Download } from 'lucide-react';
import useNetworkStore from '@/stores/useNetworkStore';
import { Device, CliMode, PC } from '@/stores/types';
import { processCliCommand, getCliPrompt, CommandContext, getCommandCompletions, getCommandHelp } from '@/lib/cliParser';
import { calculateRoutes } from '@/lib/routingEngine';
import { checkConnectivity, traceRoute } from '@/lib/connectivityEngine';

interface TerminalPanelProps {
    deviceId: string | null;
    isFullScreen?: boolean;
    onToggleFullScreen?: () => void;
}

interface CliState {
    mode: CliMode;
    hostname: string;
    currentInterface?: string;
    currentVlan?: number;
    authStage: 'none' | 'login' | 'enable';
}

export default function TerminalPanel({ deviceId, isFullScreen = false, onToggleFullScreen }: TerminalPanelProps) {
    const { devices, updateDevice, connections, terminalStates, updateTerminalState, getTerminalState } = useNetworkStore();
    const terminalRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const [currentInput, setCurrentInput] = useState('');
    const [historyIndex, setHistoryIndex] = useState(-1);

    const device = devices.find((d) => d.id === deviceId);

    // グローバルステートからターミナル状態を取得
    const terminalState = deviceId ? terminalStates[deviceId] : undefined;
    const output = terminalState?.output || [];
    const cliState: CliState = {
        mode: terminalState?.cliMode || 'user',
        hostname: device?.hostname || 'Switch',
        currentInterface: terminalState?.currentInterface,
        currentVlan: terminalState?.currentVlan,
        authStage: terminalState?.authStage || 'none',
    };
    const commandHistory = terminalState?.commandHistory || [];

    // ヘルパー関数: output更新
    const setOutput = useCallback((newOutput: string[] | ((prev: string[]) => string[])) => {
        if (!deviceId) return;
        const currentOutput = terminalStates[deviceId]?.output || [];
        const updatedOutput = typeof newOutput === 'function' ? newOutput(currentOutput) : newOutput;
        updateTerminalState(deviceId, { output: updatedOutput });
    }, [deviceId, terminalStates, updateTerminalState]);

    // ヘルパー関数: cliState更新
    const setCliState = useCallback((newState: Partial<CliState> | ((prev: CliState) => CliState)) => {
        if (!deviceId) return;
        const currentState = terminalStates[deviceId];
        const prevCliState: CliState = {
            mode: currentState?.cliMode || 'user',
            hostname: device?.hostname || 'Switch',
            currentInterface: currentState?.currentInterface,
            currentVlan: currentState?.currentVlan,
            authStage: currentState?.authStage || 'none',
        };
        const updatedState = typeof newState === 'function' ? newState(prevCliState) : { ...prevCliState, ...newState };
        updateTerminalState(deviceId, {
            cliMode: updatedState.mode,
            currentInterface: updatedState.currentInterface,
            currentVlan: updatedState.currentVlan,
            authStage: updatedState.authStage,
        });
    }, [deviceId, terminalStates, updateTerminalState, device?.hostname]);

    // ヘルパー関数: commandHistory更新
    const addToHistory = useCallback((cmd: string) => {
        if (!deviceId) return;
        const currentHistory = terminalStates[deviceId]?.commandHistory || [];
        updateTerminalState(deviceId, { commandHistory: [...currentHistory, cmd] });
    }, [deviceId, terminalStates, updateTerminalState]);

    // デバイスが変更されたらターミナルを初期化（既存のステートがない場合のみ）
    useEffect(() => {
        if (device && deviceId && !terminalStates[deviceId]) {
            // Initial Auth Check
            const hasConsolePassword = !!device.security?.consolePassword;
            if (hasConsolePassword) {
                updateTerminalState(deviceId, {
                    output: ['User Access Verification', 'Password: '],
                    cliMode: 'user',
                    commandHistory: [],
                    authStage: 'login',
                    isConsoleAuthenticated: false,
                });
            } else {
                updateTerminalState(deviceId, {
                    output: [
                        '',
                        '═══════════════════════════════════════════════',
                        `  ${device.hostname} Console`,
                        `  Type: ${device.type === 'l2-switch' ? 'Catalyst 2960-X' : device.type === 'l3-switch' ? 'Catalyst 3750-X' : 'PC'}`,
                        '═══════════════════════════════════════════════',
                        '',
                        'Press RETURN to get started.',
                        '',
                    ],
                    cliMode: 'user',
                    commandHistory: [],
                    authStage: 'none',
                    isConsoleAuthenticated: true,
                });
            }
        }
    }, [device?.id, deviceId, terminalStates, updateTerminalState, device?.security]);

    // hostname変更時にcliStateを更新
    useEffect(() => {
        if (device && device.hostname !== cliState.hostname) {
            setCliState(prev => ({ ...prev, hostname: device.hostname }));
        }
    }, [device?.hostname]);

    // ログ保存機能
    const handleSaveLog = useCallback(() => {
        const hostname = device?.hostname || 'terminal';
        const now = new Date();
        const dateStr = now.getFullYear().toString() +
            (now.getMonth() + 1).toString().padStart(2, '0') +
            now.getDate().toString().padStart(2, '0') + '_' +
            now.getHours().toString().padStart(2, '0') +
            now.getMinutes().toString().padStart(2, '0') +
            now.getSeconds().toString().padStart(2, '0');
        const filename = `${hostname}_${dateStr}.log`;

        // 直近10000行を取得
        const logLines = output.slice(-10000);
        const logContent = logLines.join('\n');

        const blob = new Blob([logContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, [device?.hostname, output]);

    // 自動スクロール
    useEffect(() => {
        if (terminalRef.current) {
            terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
        }
    }, [output]);

    const handleProcessCommand = useCallback((input: string) => {
        if (!device || device.type === 'pc') return [];

        const context: CommandContext = {
            device,
            mode: cliState.mode,
            currentInterface: cliState.currentInterface,
            currentVlan: cliState.currentVlan,
            updateDevice,
            allDevices: devices,
            allConnections: connections,
        };

        const result = processCliCommand(input, context);

        // 状態更新
        if (result.newMode !== undefined || result.newInterface !== undefined || result.newVlan !== undefined) {
            setCliState(prev => ({
                ...prev,
                mode: result.newMode ?? prev.mode,
                currentInterface: result.newInterface ?? prev.currentInterface,
                currentVlan: result.newVlan ?? prev.currentVlan,
                hostname: result.updateConfig?.hostname as string ?? prev.hostname,
                authStage: 'none', // Reset auth stage on successful normal command
            }));
        }

        // デバイス設定の更新
        if (result.updateConfig) {
            updateDevice(device.id, result.updateConfig);

            // ルーティング再計算 (Config変更があった場合)
            // 現在のデバイス状態に更新を適用した一時リストを作成
            const tempDevices = devices.map(d =>
                d.id === device.id ? { ...d, ...result.updateConfig } as Device : d
            );

            // ルーティングエンジン実行
            // 変更がルーティングに関係する場合のみ走らせるのが理想だが、
            // 簡易的にConfig変更時は常に再計算する（Static/IP設定なども含むため）
            if (device.type === 'l3-switch') {
                const updatedRoutesMap = calculateRoutes(tempDevices, connections);

                updatedRoutesMap.forEach((newRoutes, devId) => {
                    // 変更がある場合のみUpdateしたいが、ここでは単純に上書き
                    updateDevice(devId, { routingTable: newRoutes });
                });
            }
        }

        return result.output;
    }, [device, cliState, updateDevice, devices, connections]);

    if (!device) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-slate-500">
                <TerminalIcon size={32} className="mb-2" />
                <p className="text-sm">デバイスを選択してCLIを開始</p>
            </div>
        );
    }

    // PC端末の場合は簡易ターミナル
    if (device.type === 'pc') {
        return <PCTerminal device={device} allDevices={devices} allConnections={connections} isFullScreen={isFullScreen} onToggleFullScreen={onToggleFullScreen} />;
    }

    const getPrompt = () => {
        return getCliPrompt(cliState.hostname, cliState.mode, cliState.currentInterface, cliState.currentVlan);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            // AUTHENTICATION HANDLING
            if (cliState.authStage !== 'none') {
                const password = currentInput;
                const targetPassword = cliState.authStage === 'login'
                    ? (device?.security?.consolePassword || device?.security?.vtyPassword)
                    : (device?.security?.enableSecret || device?.security?.enablePassword);

                // Mask output (don't show password)
                const fullLine = ''; // Don't echo input

                if (password === targetPassword) {
                    // Success
                    if (cliState.authStage === 'login') {
                        // Logged in
                        updateTerminalState(deviceId!, {
                            authStage: 'none',
                            isConsoleAuthenticated: true,
                            output: [...output, `${getPrompt()} `] // Show prompt
                        });
                        setCliState(prev => ({ ...prev, authStage: 'none' }));
                    } else {
                        // Generic Auth Success (Enable mode)
                        // Trigger the mode switch that was pending (e.g. to Privileged)
                        updateTerminalState(deviceId!, {
                            authStage: 'none',
                            cliMode: 'privileged',
                            output: [...output, `${device?.hostname}# `]
                        });
                        setCliState(prev => ({ ...prev, authStage: 'none', mode: 'privileged' }));
                    }
                } else {
                    // Fail
                    // Cisco usually waits a bit
                    // Assuming retry
                    updateTerminalState(deviceId!, {
                        output: [...output, 'Password: ']
                    });
                }
                setCurrentInput('');
                return;
            }

            // NORMAL COMMAND HANDLING
            const prompt = getPrompt();
            const fullLine = `${prompt} ${currentInput}`;

            // Intercept 'enable' command if secret is set
            if (currentInput.trim() === 'enable' || currentInput.trim() === 'en') {
                if (device?.security?.enableSecret || device?.security?.enablePassword) {
                    setOutput(prev => [...prev, fullLine, 'Password: ']);
                    setCliState(prev => ({ ...prev, authStage: 'enable' }));
                    setCurrentInput('');
                    setHistoryIndex(-1);
                    return;
                }
            }

            const result = handleProcessCommand(currentInput);

            setOutput(prev => [...prev, fullLine, ...result]);

            if (currentInput.trim()) {
                addToHistory(currentInput);
            }
            setCurrentInput('');
            setHistoryIndex(-1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (commandHistory.length > 0) {
                const newIndex = historyIndex < commandHistory.length - 1 ? historyIndex + 1 : historyIndex;
                setHistoryIndex(newIndex);
                setCurrentInput(commandHistory[commandHistory.length - 1 - newIndex] || '');
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (historyIndex > 0) {
                const newIndex = historyIndex - 1;
                setHistoryIndex(newIndex);
                setCurrentInput(commandHistory[commandHistory.length - 1 - newIndex] || '');
            } else {
                setHistoryIndex(-1);
                setCurrentInput('');
            }
        } else if (e.key === 'Tab') {
            e.preventDefault();
            // Tab補完
            const completions = getCommandCompletions(currentInput, cliState.mode, device);
            if (completions.length === 1) {
                // 一意に確定できる場合は補完
                const completion = completions[0];
                const lastSpaceIndex = currentInput.lastIndexOf(' ');

                if (lastSpaceIndex === -1) {
                    // 1単語目 (例: "en" -> "enable")
                    setCurrentInput(completion + ' ');
                } else {
                    // 2単語目以降 (例: "show int" -> "show interfaces")
                    // 入力末尾がスペースでない場合、最後の単語を置換
                    if (!currentInput.endsWith(' ')) {
                        const prefix = currentInput.substring(0, lastSpaceIndex + 1);
                        setCurrentInput(prefix + completion + ' ');
                    } else {
                        // スペースで終わっている場合は追記
                        setCurrentInput(currentInput + completion + ' ');
                    }
                }
            } else if (completions.length > 1) {
                // 複数候補がある場合は表示
                const prompt = getPrompt();
                setOutput(prev => [
                    ...prev,
                    `${prompt} ${currentInput}`,
                    '',
                    ...completions.map(c => '  ' + c),
                    '',
                ]);
            }
        } else if (e.key === '?' && !e.shiftKey) {
            // ?キーでヘルプ表示（Shift+?は通常の?入力）
            e.preventDefault();
            const helpLines = getCommandHelp(currentInput, cliState.mode, device);
            const prompt = getPrompt();
            setOutput(prev => [
                ...prev,
                `${prompt} ${currentInput} ? `,
                ...helpLines,
                '',
            ]);
        }
    };

    return (
        <div
            className="h-full flex flex-col bg-black text-green-400 font-mono text-sm"
            onClick={() => inputRef.current?.focus()}
        >
            {/* ヘッダーバー */}
            <div className="flex items-center justify-between px-2 py-1 bg-slate-800 border-b border-slate-700 shrink-0">
                <div className="flex items-center gap-2">
                    <TerminalIcon size={14} className="text-green-400" />
                    <span className="text-xs text-slate-300">{device.hostname}</span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={(e) => { e.stopPropagation(); handleSaveLog(); }}
                        className="p-1 text-slate-400 hover:text-green-400 transition-colors"
                        title="ログを保存"
                    >
                        <Download size={14} />
                    </button>
                    {onToggleFullScreen && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onToggleFullScreen(); }}
                            className="p-1 text-slate-400 hover:text-blue-400 transition-colors"
                            title={isFullScreen ? '通常表示' : '全画面表示'}
                        >
                            {isFullScreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                        </button>
                    )}
                </div>
            </div>

            <div ref={terminalRef} className="flex-1 overflow-y-auto p-2">
                {output.map((line, i) => (
                    <div key={i} className="whitespace-pre-wrap">{line}</div>
                ))}
                <div className="flex">
                    <span>{getPrompt()}&nbsp;</span>
                    <input
                        ref={inputRef}
                        type="text"
                        value={currentInput}
                        onChange={(e) => setCurrentInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className={`flex-1 bg-transparent outline-none border-none focus:ring-0 focus:outline-none caret-green-400 ${cliState.authStage !== 'none' ? 'text-transparent' : 'text-green-400'}`}
                        autoFocus
                        spellCheck={false}
                        autoComplete="off"
                    />
                </div>
            </div>
        </div>
    );
}

// PC用簡易ターミナル
function PCTerminal({ device, allDevices, allConnections, isFullScreen = false, onToggleFullScreen }: {
    device: Device,
    allDevices: Device[],
    allConnections: any[],
    isFullScreen?: boolean,
    onToggleFullScreen?: () => void
}) {
    if (device.type !== 'pc') return null;

    const pc = device as PC;
    const terminalRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const [output, setOutput] = useState<string[]>([
        '',
        `Microsoft Windows[Version 10.0.19045.3803]`,
        '(c) Microsoft Corporation. All rights reserved.',
        '',
    ]);
    const [currentInput, setCurrentInput] = useState('');
    const [commandHistory, setCommandHistory] = useState<string[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    useEffect(() => {
        if (terminalRef.current) {
            terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
        }
    }, [output]);

    // ログ保存機能
    const handleSaveLog = useCallback(() => {
        const hostname = pc.hostname;
        const now = new Date();
        const dateStr = now.getFullYear().toString() +
            (now.getMonth() + 1).toString().padStart(2, '0') +
            now.getDate().toString().padStart(2, '0') + '_' +
            now.getHours().toString().padStart(2, '0') +
            now.getMinutes().toString().padStart(2, '0') +
            now.getSeconds().toString().padStart(2, '0');
        const filename = `${hostname}_${dateStr}.log`;

        const logLines = output.slice(-10000);
        const logContent = logLines.join('\n');

        const blob = new Blob([logContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, [pc.hostname, output]);

    const processCommand = (command: string): string[] => {
        const cmd = command.trim().toLowerCase();

        if (cmd === 'cls') {
            setOutput([]);
            return [];
        }

        if (cmd === 'ipconfig' || cmd === 'ipconfig /all') {
            return [
                '',
                'Windows IP Configuration',
                '',
                `   Host Name. . . . . . . . . . . . : ${pc.hostname}`,
                '',
                `   Ethernet adapter eth0: `,
                '',
                `      Connection - specific DNS Suffix. : `,
                `      Description. . . . . . . . . . . : Intel(R) Ethernet Connection`,
                `      Physical Address. . . . . . . . . : ${pc.macAddress}`,
                `      DHCP Enabled. . . . . . . . . . . : No`,
                `      IPv4 Address. . . . . . . . . . . : ${pc.ipAddress || 'Not configured'}`,
                `      Subnet Mask. . . . . . . . . . . : ${pc.subnetMask || 'Not configured'}`,
                `      Default Gateway. . . . . . . . . : ${pc.defaultGateway || 'Not configured'}`,
                '',
            ];
        }

        if (cmd.startsWith('ping ')) {
            const target = command.split(' ')[1];
            if (!pc.ipAddress) {
                return ['', 'PING: transmit failed. General failure.', ''];
            }

            const result = checkConnectivity(allDevices, allConnections, pc.id, target);

            const output = [
                '',
                `Pinging ${target} with 32 bytes of data: `,
            ];

            if (result.success && result.reachable) {
                for (let i = 0; i < 4; i++) {
                    output.push(`Reply from ${target}: bytes = 32 time = ${result.rtt[i]}ms TTL = 128`);
                }
                const min = Math.min(...result.rtt);
                const max = Math.max(...result.rtt);
                const avg = Math.floor(result.rtt.reduce((a, b) => a + b, 0) / result.rtt.length);
                output.push('');
                output.push(`Ping statistics for ${target}: `);
                output.push(`    Packets: Sent = 4, Received = 4, Lost = 0(0 % loss), `);
                output.push(`Approximate round trip times in milli - seconds: `);
                output.push(`    Minimum = ${min} ms, Maximum = ${max} ms, Average = ${avg} ms`);
            } else {
                for (let i = 0; i < 4; i++) {
                    output.push(result.errors[0] || 'Request timed out.');
                }
                output.push('');
                output.push(`Ping statistics for ${target}: `);
                output.push(`    Packets: Sent = 4, Received = 0, Lost = 4(100 % loss), `);
            }
            output.push('');
            return output;
        }

        if (cmd.startsWith('tracert ')) {
            const target = command.split(' ')[1];
            if (!pc.ipAddress) {
                return ['', 'Unable to resolve target system name.', ''];
            }

            const result = traceRoute(allDevices, allConnections, pc.id, target);

            const output = [
                '',
                `Tracing route to ${target} `,
                'over a maximum of 30 hops:',
                '',
            ];

            if (result.success) {
                for (const hop of result.hops) {
                    const rtt = hop.rtt < 1 ? '<1' : hop.rtt;
                    output.push(`  ${hop.hop.toString().padEnd(2)}    ${rtt.toString().padEnd(5)} ms    ${rtt.toString().padEnd(5)} ms    ${rtt.toString().padEnd(5)} ms  ${hop.ip} [${hop.hostname}]`);
                }
                output.push('');
                output.push('Trace complete.');
            } else {
                if (result.hops.length > 0) {
                    for (const hop of result.hops) {
                        const rtt = hop.rtt < 1 ? '<1' : hop.rtt;
                        output.push(`  ${hop.hop.toString().padEnd(2)}    ${rtt.toString().padEnd(5)} ms    ${rtt.toString().padEnd(5)} ms    ${rtt.toString().padEnd(5)} ms  ${hop.ip} [${hop.hostname}]`);
                    }
                }
                output.push(`  ${(result.hops.length + 1).toString().padEnd(2)}     *        *        * Request timed out.`);
                output.push('');
                output.push(result.errors[0] || 'Trace failed.');
            }

            output.push('');
            return output;
        }

        if (cmd === 'arp -a') {
            if (!pc.ipAddress) {
                return ['No ARP Entries Found.', ''];
            }
            return [
                '',
                `Interface: ${pc.ipAddress} --- 0x1`,
                '  Internet Address      Physical Address      Type',
                `  ${pc.defaultGateway || '0.0.0.0'}           00-00-00-00-00-00     dynamic`,
                '',
            ];
        }

        if (cmd === 'help' || cmd === '?') {
            return [
                '',
                'For more information on a specific command, type HELP command-name',
                '',
                'ARP        Displays and modifies the IP-to-Physical address translation tables.',
                'CLS        Clears the screen.',
                'IPCONFIG   Displays all current TCP/IP network configuration values.',
                'PING       Sends ICMP ECHO_REQUEST packets to network hosts.',
                'TRACERT    Traces the route to a remote host.',
                '',
            ];
        }

        if (cmd === '') {
            return [];
        }

        return ['', `'${command.split(' ')[0]}' is not recognized as an internal or external command, `, 'operable program or batch file.', ''];
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            const fullLine = `C: \\Users\\${pc.hostname}> ${currentInput} `;
            const result = processCommand(currentInput);
            setOutput(prev => [...prev, fullLine, ...result]);

            if (currentInput.trim()) {
                setCommandHistory(prev => [...prev, currentInput]);
            }
            setCurrentInput('');
            setHistoryIndex(-1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (commandHistory.length > 0) {
                const newIndex = historyIndex < commandHistory.length - 1 ? historyIndex + 1 : historyIndex;
                setHistoryIndex(newIndex);
                setCurrentInput(commandHistory[commandHistory.length - 1 - newIndex] || '');
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (historyIndex > 0) {
                const newIndex = historyIndex - 1;
                setHistoryIndex(newIndex);
                setCurrentInput(commandHistory[commandHistory.length - 1 - newIndex] || '');
            } else {
                setHistoryIndex(-1);
                setCurrentInput('');
            }
        }
    };

    return (
        <div
            className="h-full flex flex-col bg-black text-white font-mono text-sm"
            onClick={() => inputRef.current?.focus()}
        >
            {/* ヘッダーバー */}
            <div className="flex items-center justify-between px-2 py-1 bg-slate-800 border-b border-slate-700 shrink-0">
                <div className="flex items-center gap-2">
                    <TerminalIcon size={14} className="text-blue-400" />
                    <span className="text-xs text-slate-300">{pc.hostname}</span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={(e) => { e.stopPropagation(); handleSaveLog(); }}
                        className="p-1 text-slate-400 hover:text-blue-400 transition-colors"
                        title="ログを保存"
                    >
                        <Download size={14} />
                    </button>
                    {onToggleFullScreen && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onToggleFullScreen(); }}
                            className="p-1 text-slate-400 hover:text-blue-400 transition-colors"
                            title={isFullScreen ? '通常表示' : '全画面表示'}
                        >
                            {isFullScreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                        </button>
                    )}
                </div>
            </div>

            <div ref={terminalRef} className="flex-1 overflow-y-auto p-2">
                {output.map((line, i) => (
                    <div key={i} className="whitespace-pre-wrap">{line}</div>
                ))}
                <div className="flex">
                    <span>C:\Users\{pc.hostname}&gt;&nbsp;</span>
                    <input
                        ref={inputRef}
                        type="text"
                        value={currentInput}
                        onChange={(e) => setCurrentInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="flex-1 bg-transparent outline-none border-none text-white caret-white"
                        autoFocus
                        spellCheck={false}
                        autoComplete="off"
                    />
                </div>
            </div>
        </div>
    );
}
