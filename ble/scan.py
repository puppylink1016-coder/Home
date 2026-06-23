"""
扫描 SL278 系列设备的所有 GATT 服务和特征。
第一步：确认你的玩具能被电脑/手机找到，服务UUID对不对。
用法：python scan.py
"""
import asyncio
from bleak import BleakScanner, BleakClient

async def main():
    print("扫描 SL278 ...")
    devs = await BleakScanner.discover(timeout=8.0)
    hits = [d for d in devs if d.name and "SL278" in d.name]
    if not hits:
        print("没找到设备——确认玩具开机了、蓝牙没被手机App占着")
        return
    for dev in hits:
        print(f"\n找到：{dev.name}  地址：{dev.address}")
        try:
            async with BleakClient(dev) as c:
                for svc in c.services:
                    print(f"  [服务] {svc.uuid}")
                    for ch in svc.characteristics:
                        props = ", ".join(ch.properties)
                        print(f"      {ch.uuid}  [{props}]")
        except Exception as e:
            print(f"  连接失败：{e}")

asyncio.run(main())
