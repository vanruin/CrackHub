import requests

BASE = "https://korei.ezs.vn"
TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJBdXRoMlR5cGUiOiJVc2VyRW50IiwiSUQiOiIxIiwiVG9rZW5JZCI6IjExMzI5MDQxOTM0MDAwMDMiLCJuYmYiOjE3OTAzMDc1MTcsImV4cCI6MTg3NjcwNzUxNywiaWF0IjoxNzkwMzA3NTE3fQ.TSS2E039lQX2ISxKFBv8g7oE85x5Qsb7F2RYZLG3bkI"

s = requests.Session()
s.cookies.set("token", TOKEN, domain="korei.ezs.vn")
s.cookies.set("StockID", "11340", domain="korei.ezs.vn")
s.cookies.set("lang_name", "vn", domain="korei.ezs.vn")

r = s.get(f"{BASE}/services/preview.aspx", params={"cmd": "cus_serviceItem", "ID": 123})
print(r.text)