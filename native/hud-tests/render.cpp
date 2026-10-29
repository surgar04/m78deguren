// 只读 ETW 验收夹具：一个独立进程绘制简单颜色，限定 45 秒，不修改驱动或系统设置。
#include <windows.h>
#include <d3d11.h>
#include <dxgi.h>
static LRESULT CALLBACK WindowProc(HWND window,UINT message,WPARAM w,LPARAM l){if(message==WM_DESTROY){PostQuitMessage(0);return 0;}return DefWindowProcW(window,message,w,l);}
int WINAPI wWinMain(HINSTANCE instance,HINSTANCE,PWSTR,int){
 WNDCLASSW type{};type.hInstance=instance;type.lpfnWndProc=WindowProc;type.lpszClassName=L"ZhenjingHudTest";RegisterClassW(&type);
 HWND window=CreateWindowW(type.lpszClassName,L"臻境 · HUD 只读渲染验收（45 秒后关闭）",WS_OVERLAPPEDWINDOW,200,180,380,240,nullptr,nullptr,instance,nullptr);if(!window)return 1;
 ShowWindow(window,SW_SHOW);ShowWindow(window,SW_SHOW);UpdateWindow(window);
 DXGI_SWAP_CHAIN_DESC description{};description.BufferDesc.Format=DXGI_FORMAT_R8G8B8A8_UNORM;description.SampleDesc.Count=1;description.BufferUsage=DXGI_USAGE_RENDER_TARGET_OUTPUT;description.BufferCount=2;description.OutputWindow=window;description.Windowed=TRUE;description.SwapEffect=DXGI_SWAP_EFFECT_DISCARD;
 IDXGISwapChain* swap=nullptr;ID3D11Device* device=nullptr;ID3D11DeviceContext* context=nullptr;ID3D11Texture2D* buffer=nullptr;ID3D11RenderTargetView* view=nullptr;
 if(FAILED(D3D11CreateDeviceAndSwapChain(nullptr,D3D_DRIVER_TYPE_HARDWARE,nullptr,0,nullptr,0,D3D11_SDK_VERSION,&description,&swap,&device,nullptr,&context)))return 2;
 if(FAILED(swap->GetBuffer(0,__uuidof(ID3D11Texture2D),(void**)&buffer))||FAILED(device->CreateRenderTargetView(buffer,nullptr,&view)))return 3;
 LARGE_INTEGER frequency,start,now;QueryPerformanceFrequency(&frequency);QueryPerformanceCounter(&start);MSG message{};
 while(true){while(PeekMessageW(&message,nullptr,0,0,PM_REMOVE)){if(message.message==WM_QUIT)goto done;TranslateMessage(&message);DispatchMessageW(&message);}QueryPerformanceCounter(&now);double seconds=(now.QuadPart-start.QuadPart)/(double)frequency.QuadPart;if(seconds>45)break;
  float color[]={0.1f,0.65f,0.45f,1.f};context->ClearRenderTargetView(view,color);swap->Present(0,0);
  LARGE_INTEGER until;until.QuadPart=now.QuadPart+frequency.QuadPart/200;do{SwitchToThread();QueryPerformanceCounter(&now);}while(now.QuadPart<until.QuadPart);
 }
done: view->Release();buffer->Release();context->Release();device->Release();swap->Release();DestroyWindow(window);return 0;
}
