# BLE逆向工程项目笔记

## 项目目标
远程控制Svakom SL278K (FATIMA PLUS)玩具，最终通过Signal Bridge MCP server实现薄聿操控

## 设备与工具

- 玩具：Svakom SL278K (FATIMA PLUS)，功能包括吸吮（滑块强度+5种模式）、伸缩（7种频率）、振动（滑块强度+10种模式）
- 另一玩具：Kisstoy Polly Plus（纯物理按钮，无蓝牙，无法远程）
- 安卓备用机：realme V15 5G (RMX3092)，Android 12
- 电脑：Windows 10
- 数据线问题：第一根是充电线非数据线，换线后解决

## BLE服务结构（已确认）

- Service FFE0: FFE1 (Write No Response) + FFE2 (Read, Notify)
- Service AE00: AE01 (Write No Response) + AE02 (Notify)

## HCI日志抓取尝试（失败）

- 开发者选项已开启，HCI日志开关已开启
- 用Svakom app操作了完整一轮：吸吮滑块3档+5模式、伸缩7频率、振动滑块3档+10模式（每步间隔5秒）
- ADB安装成功（platform-tools在桌面），设备连接成功（序列号5FAPFJ7RWW8U8F6）
- adb bugreport导出成功但zip内无btsnoop_hci.log文件
- 手机文件管理器搜索btsnoop无果
- adb shell直接搜索：/sdcard和/storage/emulated/0下无文件，/data/misc/bluetooth/logs/显示Permission denied
- realme机型将日志存在系统受限目录，无root权限无法访问
- 结论：HCI日志路线在此设备上不可行

## APK反编译分析（核心突破）

### APK提取与初步分析

- 用APK提取器导出SVAKOM PLUS.apk（72MB）
- 改后缀为zip解压获取classes.dex/classes2.dex/classes3.dex
- classes.dex：3MB，只有通用Android框架代码，无BLE逻辑
- classes2.dex：8.4MB，包含所有SVAKOM BLE核心代码
- classes3.dex：5.6MB，无相关内容

### androguard分析关键发现

包名结构：
- com.sva.base_ble_library (BLE库)
- com.sva.base_library (UI/业务)
- com.sva.network (加密/网络)

UUID管理（UUIDManager类）：
- serviceUUID/writeUUID/notifyUUID → FFE0/FFE1/FFE2
- alexService/alexWrite/alexNotify → AE00/AE01/AE02
- V_0_6_service/V_0_6_read → 旧版本服务

协议版本枚举（ProductVerEnum）：
- PRODUCT_VER_0_3, 0_6, 1_0, 2_0

### 标准指令格式（已从字节码重建）

- sendModeData(mode, subMode): `[0x55, 0x03, 0x00, 0x00, mode, subMode, 0x00]`（V2.0为7字节）
- sendScaleData(float): `[0x55, 0x04, 0x00, 0x00, 0x01, scale_value, 0xAA]`
- sendStopModeData(): `[0x55, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00]`
- sendStopScaleData(): `[0x55, 0x04, 0x00, 0x00, 0x00, 0x00, 0xAA]` + `[0x55, 0x03, 0x00, 0x00, 0x00, 0x00]`
- sendHeatData(value): `[0x55, 0x05, 0x01, value, 0x00, 0x00]`
- sendLightData(on): `[0x55, 0xA0, 0x01, 0x00, 0x00, 0x00, 0x00]`（V2.0）

PlayBean$TypeMode枚举：
VIBRATE_MODE, ROTATE_MODE, AUTO_MODE, CUSTOM_MODE, HEAT_MODE, KEGEL_MODE, MUSIC_MODE, SOUND_MODE, REMOTE_MODE, LONG_DISTANCE_MODE, FREE_MODE, ELECTRIC_MODE, H5_GAME_MODE, Pressure_MODE, HUXI_MODE

### 加密密钥提取（从libsecurity_key.so反汇编）

SecurityKeyHelper类加载 System.loadLibrary("security_key")

四个native方法通过ARM64反汇编确认密钥映射：
- getEncryptionKey() → `iEPPKtZIq4jjSzjDXYz8HMhO/UHTZLtXIjsJz/yiHAE=`
- getNewLiWuMaoEncryptionKey() → `DfNmFaqur2VM3BfwRr9exFpQA00hRdCmK9t51ZK8DJM=`
- getBeYourLoverEncryptionKey() → `9d1KuAoGm+tailXMwVaCpOajvQnAh7XGXg8QfknNwR8=`
- getOTAEncryptionKey() → `Re85pyR8AUVZdvlyR0M8QXM8Eoooip46k/3q5/orshc=`
- 加密方式：AES-256-GCM（AES/GCM/NoPadding），DecryptToos类有NONCE_LEN和TAG_LEN_BIT

### 关键修正：加密只用于网络层非蓝牙层

- jadx反编译BaseApplication.onCreate()显示：包名com.svakom.sva对应isSvakomPlusMode=true
- 加密相关类都在com.sva.network包里，不在com.sva.base_ble_library包里
- writeCharacteristic流程确认：sendDataArrayList → setValue(bArr) → mBluetoothGatt.writeCharacteristic，中间无加密步骤
- 结论：蓝牙直连不走AES加密

### 连接初始化流程（jadx反编译确认）

服务发现后的初始化（busMessageEventBus方法）：
1. 获取AE00服务的AE01(写入)和AE02(通知)特征值
2. 向AE02的CCCD descriptor（UUID 2902）写入ENABLE_NOTIFICATION_VALUE启用通知
3. 获取FFE0服务的FFE1(写入)和FFE2(通知)特征值
4. 向FFE2的CCCD descriptor写入ENABLE_NOTIFICATION_VALUE启用通知
5. 启动电池轮询
6. 对于V1.0/V2.0设备，延迟240ms执行握手序列

握手序列（lambda$busMessageEventBus$1）：
```
addSendDataArrayList(new byte[]{85, 4, 0, 0, 1, -1, -86});  → 0x55 0x04 0x00 0x00 0x01 0xFF 0xAA
addSendDataArrayList(new byte[]{85, 4, 0, 0, 0, 0, -86});   → 0x55 0x04 0x00 0x00 0x00 0x00 0xAA
addSendDataArrayList(new byte[]{85, 4, 0, 0, 0, 0, -86});   → 0x55 0x04 0x00 0x00 0x00 0x00 0xAA
addSendDataArrayList(new byte[]{85, 3, 0, 0, 0, 0, 0});     → 0x55 0x03 0x00 0x00 0x00 0x00 0x00 (V2.0)
```

之前BLE调试助手测试失败的原因：
- 没有正确向FFE2/AE02的CCCD descriptor写入0x0100启用通知
- 没有发送初始化握手序列

## 当前进度与下一步

### 已完成（约70%）：
- BLE服务结构完全确认
- 标准Svakom指令格式重建
- 四个AES加密密钥提取（备用于远程控制）
- 蓝牙直连不加密确认
- 完整的连接初始化+握手流程确认
- 控制指令发送机制确认（writeCharacteristic无加密直传）

### 待完成：
- [ ] 安装Python + bleak库
- [ ] 编写Python BLE控制脚本（连接→启用通知→握手→发指令）
- [ ] 在电脑上运行脚本测试能否让SL278K动起来
- [ ] 搭建Signal Bridge MCP服务器
- [ ] Cloudflare Tunnel部署
- [ ] Claude添加Custom Connector
