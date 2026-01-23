'use client';

import React, { useCallback, useRef, useState } from 'react';
import {
    ReactFlow,
    Node,
    Edge,
    Controls,
    Background,
    useNodesState,
    useEdgesState,
    addEdge,
    Connection,
    NodeTypes,
    BackgroundVariant,
    ReactFlowProvider,
    useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import useNetworkStore, { createL2Switch, createL3Switch, createPC } from '@/stores/useNetworkStore';
import L2SwitchNode from './nodes/L2SwitchNode';
import L3SwitchNode from './nodes/L3SwitchNode';
import PCNode from './nodes/PCNode';
import PortSelectModal from './PortSelectModal';

// カスタムノード定義
const nodeTypes: NodeTypes = {
    'l2-switch': L2SwitchNode,
    'l3-switch': L3SwitchNode,
    'pc': PCNode,
};

interface PendingConnection {
    sourceId: string;
    targetId: string;
}

function NetworkCanvasInner() {
    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const { screenToFlowPosition } = useReactFlow();

    const {
        devices,
        connections,
        addDevice,
        updateDevicePosition,
        connectPorts,
        selectDevice,
        removeConnection,
    } = useNetworkStore();

    const [portSelectModal, setPortSelectModal] = useState<{
        open: boolean;
        sourceDeviceId: string;
        targetDeviceId: string;
    }>({ open: false, sourceDeviceId: '', targetDeviceId: '' });

    // デバイスをReact Flowノードに変換
    const initialNodes: Node[] = devices.map((device) => ({
        id: device.id,
        type: device.type,
        position: device.position,
        data: { device },
    }));

    // 接続をReact Flowエッジに変換
    const initialEdges: Edge[] = connections.map((conn) => ({
        id: conn.id,
        source: conn.sourceDeviceId,
        target: conn.targetDeviceId,
        animated: conn.status === 'up',
        style: { stroke: conn.status === 'up' ? '#22c55e' : '#ef4444', strokeWidth: 2 },
    }));

    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    // ストアの変更を監視してローカルステートを更新
    React.useEffect(() => {
        const newNodes: Node[] = devices.map((device) => ({
            id: device.id,
            type: device.type,
            position: device.position,
            data: { device },
        }));
        setNodes(newNodes);
    }, [devices, setNodes]);

    React.useEffect(() => {
        const newEdges: Edge[] = connections.map((conn) => ({
            id: conn.id,
            source: conn.sourceDeviceId,
            target: conn.targetDeviceId,
            animated: conn.status === 'up',
            style: { stroke: conn.status === 'up' ? '#22c55e' : '#ef4444', strokeWidth: 2 },
        }));
        setEdges(newEdges);
    }, [connections, setEdges]);

    // ノード位置変更時
    const onNodeDragStop = useCallback(
        (_: React.MouseEvent, node: Node) => {
            updateDevicePosition(node.id, node.position);
        },
        [updateDevicePosition]
    );

    // ノードクリック時
    const onNodeClick = useCallback(
        (_: React.MouseEvent, node: Node) => {
            selectDevice(node.id);
        },
        [selectDevice]
    );

    // 接続作成時（ポート選択モーダルを表示）
    const onConnect = useCallback(
        (params: Connection) => {
            if (params.source && params.target) {
                setPortSelectModal({
                    open: true,
                    sourceDeviceId: params.source,
                    targetDeviceId: params.target,
                });
            }
        },
        []
    );

    // ポート選択完了時
    const handlePortSelect = useCallback(
        (sourcePortId: string, targetPortId: string) => {
            connectPorts(
                portSelectModal.sourceDeviceId,
                sourcePortId,
                portSelectModal.targetDeviceId,
                targetPortId
            );
            setPortSelectModal({ open: false, sourceDeviceId: '', targetDeviceId: '' });
        },
        [connectPorts, portSelectModal]
    );

    // エッジ削除時
    const onEdgeClick = useCallback(
        (_: React.MouseEvent, edge: Edge) => {
            if (confirm('この接続を削除しますか？')) {
                removeConnection(edge.id);
            }
        },
        [removeConnection]
    );

    // ドラッグ＆ドロップでデバイス追加
    const onDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    const onDrop = useCallback(
        (event: React.DragEvent) => {
            event.preventDefault();

            const type = event.dataTransfer.getData('application/device-type');
            if (!type) return;

            const position = screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
            });

            let device;
            const timestamp = Date.now().toString(36).slice(-4).toUpperCase();

            switch (type) {
                case 'l2-switch':
                    device = createL2Switch(`SW-${timestamp}`, position);
                    break;
                case 'l3-switch':
                    device = createL3Switch(`L3SW-${timestamp}`, position);
                    break;
                case 'pc':
                    device = createPC(`PC-${timestamp}`, position);
                    break;
                default:
                    return;
            }

            addDevice(device);
        },
        [screenToFlowPosition, addDevice]
    );

    return (
        <div ref={reactFlowWrapper} className="w-full h-full">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeDragStop={onNodeDragStop}
                onNodeClick={onNodeClick}
                onEdgeClick={onEdgeClick}
                onDragOver={onDragOver}
                onDrop={onDrop}
                nodeTypes={nodeTypes}
                fitView
                className="bg-slate-900"
            >
                <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#475569" />
                <Controls className="bg-slate-800 border-slate-700" />
            </ReactFlow>

            <PortSelectModal
                open={portSelectModal.open}
                onClose={() => setPortSelectModal({ open: false, sourceDeviceId: '', targetDeviceId: '' })}
                sourceDeviceId={portSelectModal.sourceDeviceId}
                targetDeviceId={portSelectModal.targetDeviceId}
                onSelect={handlePortSelect}
            />
        </div>
    );
}

export default function NetworkCanvas() {
    return (
        <ReactFlowProvider>
            <NetworkCanvasInner />
        </ReactFlowProvider>
    );
}
