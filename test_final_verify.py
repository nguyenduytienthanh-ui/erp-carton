"""
Final verification test - check if error is fixed
"""
import time
import os
import sys
from playwright.sync_api import sync_playwright

# Set UTF-8 encoding
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

def test_final_verification():
    """Final verification if error is fixed"""
    with sync_playwright() as p:
        browser = None
        try:
            browser = p.chromium.launch(headless=False)
            context = browser.new_context(viewport={'width': 1920, 'height': 1080})
            page = context.new_page()
            
            # Track console errors
            console_errors = []
            def handle_console(msg):
                if msg.type == 'error':
                    console_errors.append(msg.text)
            page.on("console", handle_console)
            
            print("="*70)
            print("FINAL VERIFICATION TEST - Is Error Fixed?")
            print("="*70)
            
            # Navigate
            page.goto("http://127.0.0.1:5174/products")
            page.wait_for_load_state('networkidle')
            time.sleep(1)
            
            if "login" in page.url.lower():
                page.locator("input[type='text']").first.fill("admin")
                page.locator("input[type='password']").first.fill("admin123")
                page.locator("button[type='submit']").first.click()
                page.wait_for_load_state('networkidle')
                time.sleep(2)
                if "products" not in page.url:
                    page.goto("http://127.0.0.1:5174/products")
                    page.wait_for_load_state('networkidle')
                    time.sleep(1)
            
            # Execute JavaScript
            print("\nExecuting: document.querySelector('tbody .anticon-project')?.click()")
            page.evaluate("document.querySelector('tbody .anticon-project')?.click()")
            
            print("Waiting 2 seconds...")
            time.sleep(2)
            
            page.screenshot(path="d:/ERP-Carton/screenshots/final_01_modal.png")
            print("📸 Screenshot 1: modal after click")
            
            # Click "Thêm nhiệm vụ mới"
            print("\nClicking 'Thêm nhiệm vụ mới'...")
            
            errors_before = len(console_errors)
            
            page.evaluate("""
                () => {
                    const buttons = Array.from(document.querySelectorAll('.ant-modal button'));
                    const addButton = buttons.find(b => b.textContent.includes('Thêm nhiệm vụ mới'));
                    if (addButton) addButton.click();
                }
            """)
            
            time.sleep(2)
            
            page.screenshot(path="d:/ERP-Carton/screenshots/final_02_after_add.png")
            print("📸 Screenshot 2: after clicking add button")
            
            # Check for error boundary
            has_error_boundary = page.evaluate("""
                () => {
                    const errorText = document.body.textContent;
                    return errorText.includes('Đã xảy ra lỗi') || errorText.includes('Maximum update depth');
                }
            """)
            
            # Check for form inputs
            has_form_inputs = page.evaluate("""
                () => {
                    return document.querySelectorAll('.ant-modal input, .ant-modal textarea').length > 0;
                }
            """)
            
            print(f"\nError boundary visible: {has_error_boundary}")
            print(f"Form inputs found: {has_form_inputs}")
            
            # Answer question 1
            form_appears_without_error = has_form_inputs and not has_error_boundary
            
            print("\n" + "="*70)
            print("ANSWER 1: Does the form appear without error?")
            print("="*70)
            print(f"{'YES ✅' if form_appears_without_error else 'NO ❌'}")
            
            if form_appears_without_error:
                # Try to create task
                print("\n" + "="*70)
                print("Attempting to create task...")
                print("="*70)
                
                # Fill title
                fill_result = page.evaluate("""
                    () => {
                        const inputs = document.querySelectorAll('.ant-modal input[type="text"], .ant-modal input:not([type])');
                        if (inputs.length > 0) {
                            const input = inputs[0];
                            input.value = 'Test task';
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                            return true;
                        }
                        return false;
                    }
                """)
                print(f"Filled title: {fill_result}")
                
                time.sleep(0.5)
                
                # Click create
                create_result = page.evaluate("""
                    () => {
                        const buttons = Array.from(document.querySelectorAll('.ant-modal button'));
                        const createButton = buttons.find(b => b.textContent.includes('Tạo nhiệm vụ'));
                        if (createButton) {
                            createButton.click();
                            return true;
                        }
                        return false;
                    }
                """)
                print(f"Clicked create button: {create_result}")
                
                time.sleep(2)
                
                page.screenshot(path="d:/ERP-Carton/screenshots/final_03_after_create.png")
                print("📸 Screenshot 3: after create")
                
                # Check for success
                has_success = page.evaluate("""
                    () => {
                        return document.querySelector('.ant-message-success') !== null;
                    }
                """)
                
                can_create_task = fill_result and create_result and has_success
                
                print("\n" + "="*70)
                print("ANSWER 2: Can you create a task?")
                print("="*70)
                print(f"{'YES ✅' if can_create_task else 'NO ❌'}")
            else:
                print("\n" + "="*70)
                print("ANSWER 2: Can you create a task?")
                print("="*70)
                print("NO ❌ (Form did not appear)")
                can_create_task = False
            
            # Console errors
            new_errors = len(console_errors) - errors_before
            has_max_depth_error = any('Maximum update depth' in err for err in console_errors)
            
            print("\n" + "="*70)
            print("ANSWER 3: Any console errors?")
            print("="*70)
            
            if new_errors > 0 or has_max_depth_error:
                print(f"YES ❌ - {new_errors} new errors")
                if has_max_depth_error:
                    print("  - 'Maximum update depth exceeded' error present")
            else:
                print("NO ✅ - No new console errors")
            
            print("\n" + "="*70)
            print("FINAL SUMMARY")
            print("="*70)
            print(f"1. Form appears without error: {'YES ✅' if form_appears_without_error else 'NO ❌'}")
            print(f"2. Can create task: {'YES ✅' if can_create_task else 'NO ❌'}")
            print(f"3. Console errors: {'YES ❌' if (new_errors > 0 or has_max_depth_error) else 'NO ✅'}")
            
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
    test_final_verification()
