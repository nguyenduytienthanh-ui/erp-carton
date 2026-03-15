"""
Test 1: Task creation
Test 2: Error checking
"""
import time
import sys
from playwright.sync_api import sync_playwright

# Set UTF-8 encoding
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

def run_tests():
    with sync_playwright() as p:
        browser = None
        try:
            browser = p.chromium.launch(headless=False)
            context = browser.new_context(viewport={'width': 1920, 'height': 1080})
            page = context.new_page()
            
            # Track console errors
            console_errors = []
            max_depth_errors = []
            
            def handle_console(msg):
                if msg.type == 'error':
                    console_errors.append(msg.text)
                    if 'Maximum update depth' in msg.text:
                        max_depth_errors.append(msg.text)
                        print(f"⚠️ Maximum update depth error detected at {time.time()}")
            
            page.on("console", handle_console)
            
            print("="*70)
            print("TEST 1: TASK CREATION")
            print("="*70)
            
            # Navigate and login
            page.goto("http://127.0.0.1:5174/products")
            page.wait_for_load_state('networkidle')
            time.sleep(1)
            
            if "login" in page.url.lower():
                print("Logging in...")
                page.locator("input[type='text']").first.fill("admin")
                page.locator("input[type='password']").first.fill("admin123")
                page.locator("button[type='submit']").first.click()
                page.wait_for_load_state('networkidle')
                time.sleep(2)
                if "products" not in page.url:
                    page.goto("http://127.0.0.1:5174/products")
                    page.wait_for_load_state('networkidle')
                    time.sleep(1)
            
            # Step 1: Click icon
            print("\nStep 1: Clicking task icon...")
            page.evaluate("document.querySelector('tbody .anticon-project')?.click()")
            print("✓ Clicked")
            
            # Step 2: Wait 2 seconds
            print("\nStep 2: Waiting 2 seconds...")
            time.sleep(2)
            print("✓ Done")
            
            # Step 3: Click "Thêm nhiệm vụ mới"
            print("\nStep 3: Clicking 'Thêm nhiệm vụ mới'...")
            add_clicked = page.evaluate("""
                () => {
                    const buttons = Array.from(document.querySelectorAll('.ant-modal button'));
                    const addButton = buttons.find(b => b.textContent.includes('Thêm nhiệm vụ mới'));
                    if (addButton) {
                        addButton.click();
                        return true;
                    }
                    return false;
                }
            """)
            print(f"✓ Button clicked: {add_clicked}")
            
            time.sleep(2)
            
            # Step 4: Type in title field
            print("\nStep 4: Typing 'Kiểm tra sản phẩm'...")
            
            # First, check if form appeared
            form_visible = page.evaluate("""
                () => {
                    return document.querySelectorAll('.ant-modal input').length > 0;
                }
            """)
            
            if not form_visible:
                print("❌ Form did not appear!")
            else:
                fill_result = page.evaluate("""
                    () => {
                        const inputs = document.querySelectorAll('.ant-modal input[type="text"], .ant-modal input:not([type])');
                        for (let input of inputs) {
                            const label = input.closest('.ant-form-item')?.querySelector('label');
                            if (label && label.textContent.includes('Tiêu đề')) {
                                input.value = 'Kiểm tra sản phẩm';
                                input.dispatchEvent(new Event('input', { bubbles: true }));
                                input.dispatchEvent(new Event('change', { bubbles: true }));
                                return 'Found label';
                            }
                        }
                        if (inputs.length > 0) {
                            inputs[0].value = 'Kiểm tra sản phẩm';
                            inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
                            inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
                            return 'Used first input';
                        }
                        return 'No inputs found';
                    }
                """)
                print(f"✓ Filled: {fill_result}")
                time.sleep(0.5)
            
            # Step 5: Click "Tạo nhiệm vụ"
            print("\nStep 5: Clicking 'Tạo nhiệm vụ'...")
            create_result = page.evaluate("""
                () => {
                    const buttons = Array.from(document.querySelectorAll('.ant-modal button'));
                    const createButton = buttons.find(b => b.textContent.includes('Tạo nhiệm vụ'));
                    if (createButton) {
                        const disabled = createButton.disabled || createButton.classList.contains('ant-btn-disabled');
                        if (!disabled) {
                            createButton.click();
                            return 'Clicked';
                        }
                        return 'Button is disabled';
                    }
                    return 'Button not found';
                }
            """)
            print(f"✓ Result: {create_result}")
            
            time.sleep(2)
            
            # Step 6: Check for success
            print("\nStep 6: Checking for success message...")
            page.screenshot(path="d:/ERP-Carton/screenshots/test_create_result.png")
            print("📸 Screenshot saved")
            
            success_check = page.evaluate("""
                () => {
                    const body = document.body.textContent;
                    const hasSuccess = body.includes('Đã tạo nhiệm vụ!') || 
                                      body.includes('thành công') ||
                                      document.querySelector('.ant-message-success') !== null;
                    const modalClosed = document.querySelector('.ant-modal') === null;
                    
                    return {
                        hasSuccess: hasSuccess,
                        modalClosed: modalClosed,
                        bodyIncludes: {
                            'Đã tạo nhiệm vụ!': body.includes('Đã tạo nhiệm vụ!'),
                            'thành công': body.includes('thành công'),
                            'successIcon': document.querySelector('.ant-message-success') !== null
                        }
                    };
                }
            """)
            
            task_created = success_check['hasSuccess'] or success_check['modalClosed']
            
            print(f"\n📊 Success check results:")
            print(f"  - Has success message: {success_check['hasSuccess']}")
            print(f"  - Modal closed: {success_check['modalClosed']}")
            print(f"  - 'Đã tạo nhiệm vụ!' found: {success_check['bodyIncludes']['Đã tạo nhiệm vụ!']}")
            print(f"  - 'thành công' found: {success_check['bodyIncludes']['thành công']}")
            print(f"  - Success icon: {success_check['bodyIncludes']['successIcon']}")
            
            print("\n" + "="*70)
            print("TEST 2: ERROR CHECKING")
            print("="*70)
            
            # Step 7: Wait 10 seconds
            print("\nStep 7: Waiting 10 seconds...")
            for i in range(10):
                time.sleep(1)
                print(f"  {i+1}/10 seconds...")
            
            # Step 8: Check console errors
            print("\nStep 8: Checking console for errors...")
            max_depth_count = len(max_depth_errors)
            
            print(f"\n📊 Console error summary:")
            print(f"  - Total console errors: {len(console_errors)}")
            print(f"  - 'Maximum update depth' errors: {max_depth_count}")
            
            # Final report
            print("\n" + "="*70)
            print("FINAL REPORT")
            print("="*70)
            print(f"\nTest 1 - Task Creation:")
            print(f"  Was the task created? {'YES ✅' if task_created else 'NO ❌'}")
            if task_created:
                print(f"  Evidence: ", end="")
                if success_check['bodyIncludes']['Đá tạo nhiệm vụ!']:
                    print("Success message found")
                elif success_check['modalClosed']:
                    print("Modal closed (typical success behavior)")
                else:
                    print("Success indicator detected")
            
            print(f"\nTest 2 - Error Checking:")
            print(f"  'Maximum update depth' errors: {max_depth_count}")
            print(f"  Status: {'FAIL ❌' if max_depth_count > 0 else 'PASS ✅'}")
            
            print("\nKeeping browser open for 5 seconds...")
            time.sleep(5)
            
        except Exception as e:
            print(f"\n❌ ERROR: {e}")
            import traceback
            traceback.print_exc()
        
        finally:
            if browser:
                browser.close()

if __name__ == "__main__":
    run_tests()
