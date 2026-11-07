package net.takisa.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 🪤 التسجيلُ **قبل** `super.onCreate`: الجسرُ يُبنى داخل `super`،
        //    وتسجيلٌ بعده لا يراه الـWebView فيردّ «الإضافةُ غير موجودة»
        //    بلا أيّ خطأ ترجمة.
        registerPlugin(TakiIapPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
